'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const mailer = require('../utils/mailer');
const { buildTrackingUrl, extractSku } = require('../utils/helpers');
const { COLUMNS, toCsv, parseTable, looksLikeHeader } = require('../utils/csv');

async function getAdminEmails() {
  const rows = await db.prepare("SELECT email FROM users WHERE role = 'admin'").all();
  return rows.map((r) => r.email);
}
function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

// Các trạng thái đơn hàng (Trạng Thái) + màu badge
const STATUSES = ['Chờ xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'];
function normStatus(s) {
  s = (s || '').trim();
  return STATUSES.includes(s) ? s : 'Chờ xử lý';
}
function intOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Lấy tiền tố SKU từ tên sản phẩm (bỏ dấu tiếng Việt, lấy chữ cái đầu các từ)
function skuPrefix(name) {
  const ascii = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const words = ascii.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let prefix = '';
  if (words.length >= 2) prefix = words.slice(0, 4).map((w) => w[0]).join('');
  else if (words.length === 1) prefix = words[0].slice(0, 4);
  return prefix || 'SP';
}

// Tạo SKU ngẫu nhiên theo tên + số, đảm bảo không trùng trong kho
async function generateSku(name) {
  const prefix = skuPrefix(name);
  for (let i = 0; i < 50; i++) {
    const sku = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await db.prepare('SELECT 1 FROM inventory WHERE sku = ?').get(sku))) return sku;
  }
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

// SKU cuối cùng: ưu tiên nhập tay -> bóc từ link -> tự tạo theo tên
async function resolveSku(manual, url, name, fallbackSku) {
  const sku = (manual && manual.trim()) || extractSku(url);
  if (sku) return sku;
  return fallbackSku || (await generateSku(name));
}
// Tìm danh mục theo tên, tạo mới nếu chưa có (dùng cho nhập hàng loạt)
async function resolveCategoryId(name) {
  name = (name || '').trim();
  if (!name) return null;
  let row = await db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (!row) row = { id: (await db.prepare('INSERT INTO categories (name) VALUES (?)').run(name)).lastInsertRowid };
  return row.id;
}
async function resolveSupplierId(name) {
  name = (name || '').trim();
  if (!name) return null;
  let row = await db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name);
  if (!row) row = { id: (await db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(name)).lastInsertRowid };
  return row.id;
}

// Câu SELECT chuẩn kèm tên danh mục + nhà cung cấp + số khả dụng
const SELECT_ITEM = `
  SELECT i.*, c.name AS category, s.name AS supplier,
         (i.quantity + i.on_order) AS available
  FROM inventory i
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN suppliers  s ON s.id = i.supplier_id
`;

// ===================== DANH SÁCH / DASHBOARD =====================
router.get('/dashboard', ensureAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let items;
    if (q) {
      const like = `%${q}%`;
      items = await db.prepare(`${SELECT_ITEM}
        WHERE i.name LIKE ? OR i.sku LIKE ? OR i.inbound_id LIKE ? OR i.tracking LIKE ?
           OR c.name LIKE ? OR s.name LIKE ?
        ORDER BY i.id DESC
      `).all(like, like, like, like, like, like);
    } else {
      items = await db.prepare(`${SELECT_ITEM} ORDER BY i.id DESC`).all();
    }
    items.forEach((it) => { it.tracking_url = buildTrackingUrl(it.carrier, it.tracking); });

    const stats = {
      totalItems: (await db.prepare('SELECT COUNT(*) AS c FROM inventory').get()).c,
      onHand:   (await db.prepare('SELECT COALESCE(SUM(quantity),0) AS s FROM inventory').get()).s,
      onOrder:  (await db.prepare('SELECT COALESCE(SUM(on_order),0) AS s FROM inventory').get()).s,
      available: (await db.prepare('SELECT COALESCE(SUM(quantity + on_order),0) AS s FROM inventory').get()).s,
      saleValue: (await db.prepare('SELECT COALESCE(SUM(sale_price * quantity),0) AS s FROM inventory').get()).s,
      lowStock: (await db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE min_quantity > 0 AND quantity <= min_quantity').get()).c,
    };

    res.render('dashboard', { title: 'Quản lý kho', items, stats, q, statuses: STATUSES });
  } catch (e) { next(e); }
});

// ===================== XUẤT CSV (mở bằng Google Sheets) =====================
router.get('/inventory/export.csv', ensureAuth, async (req, res, next) => {
  try {
    const items = await db.prepare(`${SELECT_ITEM} ORDER BY i.id ASC`).all();
    const csv = toCsv(items);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kho-hang-${stamp}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ===================== NHẬP HÀNG LOẠT (form) =====================
router.get('/inventory/import', ensureAuth, (req, res) => {
  res.render('import', { title: 'Nhập hàng loạt', columns: COLUMNS, result: null });
});

// ===================== NHẬP HÀNG LOẠT (xử lý) =====================
router.post('/inventory/import', ensureAuth, async (req, res, next) => {
  try {
    const text = (req.body.data || '').trim();
    if (!text) {
      req.flash('error', 'Chưa có dữ liệu để nhập. Hãy dán dữ liệu hoặc chọn file CSV.');
      return res.redirect('/inventory/import');
    }

    let rows = parseTable(text);
    if (rows.length && looksLikeHeader(rows[0])) rows = rows.slice(1);

    const insert = db.prepare(`
      INSERT INTO inventory
        (sku, name, category_id, color, variant, version, cost_price, sale_price, supplier_id,
         quantity, on_order, min_quantity, max_quantity,
         inbound_id, date, size, weight, tracking, carrier, eta, product_url, image_url, address, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTxn = db.prepare('INSERT INTO transactions (inventory_id, type, quantity, note, user_id) VALUES (?, ?, ?, ?, ?)');

    let ok = 0;
    const errors = [];
    let baseCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM inventory').get()).c);

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      // Thứ tự cột khớp utils/csv.js: sku, name, category, color, variant, version, cost_price,
      //   sale_price, supplier, quantity, on_order, min, max, inbound_id, date, size, weight,
      //   tracking, carrier, eta, product_url, image_url
      const g = (i) => (r[i] != null ? String(r[i]).trim() : '');
      const name = g(1);
      if (!name) { errors.push(`Dòng ${idx + 1}: thiếu Tên sản phẩm — bỏ qua.`); continue; }

      const productUrl = g(20) || null;
      const sku = await resolveSku(g(0), productUrl, name);
      const qty = Math.round(num(g(9)));
      let inboundId = g(13);
      if (!inboundId) { baseCount++; inboundId = 'I' + baseCount; }

      try {
        const info = await insert.run(
          sku, name, await resolveCategoryId(g(2)), g(3) || null, g(4) || null, g(5) || null,
          g(6) ? num(g(6)) : null, g(7) ? num(g(7)) : null, await resolveSupplierId(g(8)),
          qty, Math.round(num(g(10))), Math.round(num(g(11))), Math.round(num(g(12))),
          inboundId, g(14) || null, g(15) || null, g(16) || null,
          g(17) || null, g(18) || null, g(19) || null, productUrl, g(21) || null,
          g(22) || null, normStatus(g(23)), req.user.id
        );
        if (qty > 0) await insertTxn.run(info.lastInsertRowid, 'in', qty, 'Nhập hàng loạt', req.user.id);
        ok++;
      } catch (e) {
        errors.push(`Dòng ${idx + 1} (${name}): ${e.message}`);
      }
    }

    res.render('import', { title: 'Nhập hàng loạt', columns: COLUMNS, result: { ok, total: rows.length, errors } });
  } catch (e) { next(e); }
});

// Danh sách dropdown cho form
async function dropdownData() {
  return {
    categories: await db.prepare('SELECT id, name FROM categories ORDER BY name').all(),
    suppliers: await db.prepare('SELECT id, name FROM suppliers ORDER BY name').all(),
    statuses: STATUSES,
  };
}

// ===================== FORM THÊM =====================
router.get('/inventory/new', ensureAuth, async (req, res, next) => {
  try {
    res.render('inventory_form', Object.assign({ title: 'Thêm sản phẩm', item: null }, await dropdownData()));
  } catch (e) { next(e); }
});

// ===================== TẠO MỚI =====================
router.post('/inventory', ensureAuth, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.name.trim()) {
      req.flash('error', 'Tên sản phẩm là bắt buộc.');
      return res.redirect('/inventory/new');
    }
    let inboundId = (b.inbound_id || '').trim();
    if (!inboundId) {
      inboundId = 'I' + (Number((await db.prepare('SELECT COUNT(*) AS c FROM inventory').get()).c) + 1);
    }
    const sku = await resolveSku(b.sku, b.product_url, b.name.trim());
    const qty = Math.round(num(b.quantity));

    const info = await db.prepare(`
      INSERT INTO inventory
        (sku, name, category_id, color, variant, version, cost_price, sale_price, supplier_id,
         quantity, on_order, min_quantity, max_quantity,
         inbound_id, date, size, weight, tracking, carrier, eta, product_url, image_url, address, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sku, b.name.trim(), intOrNull(b.category_id), b.color || null, b.variant || null, b.version || null,
      b.cost_price ? num(b.cost_price) : null, b.sale_price ? num(b.sale_price) : null, intOrNull(b.supplier_id),
      qty, Math.round(num(b.on_order)), Math.round(num(b.min_quantity)), Math.round(num(b.max_quantity)),
      inboundId, b.date || null, b.size || null, b.weight || null,
      b.tracking || null, b.carrier || null, b.eta || null, b.product_url || null, b.image_url || null,
      b.address || null, normStatus(b.status), req.user.id
    );

    if (qty > 0) {
      await db.prepare('INSERT INTO transactions (inventory_id, type, quantity, note, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(info.lastInsertRowid, 'in', qty, 'Khởi tạo sản phẩm', req.user.id);
    }
    req.flash('success', `Đã thêm sản phẩm "${b.name.trim()}".`);
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== THAO TÁC HÀNG LOẠT =====================
function bodyIds(req) {
  let ids = req.body.ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  return ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
}

// Đổi trạng thái nhiều sản phẩm
router.post('/inventory/bulk-status', ensureAuth, async (req, res, next) => {
  try {
    const ids = bodyIds(req);
    const status = normStatus(req.body.status);
    for (const id of ids) {
      await db.prepare("UPDATE inventory SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, id);
    }
    req.flash('success', `Đã đổi trạng thái ${ids.length} sản phẩm thành "${status}".`);
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// Xóa nhiều sản phẩm (chỉ Admin)
router.post('/inventory/bulk-delete', ensureAdmin, async (req, res, next) => {
  try {
    const ids = bodyIds(req);
    for (const id of ids) {
      await db.prepare('DELETE FROM transactions WHERE inventory_id = ?').run(id);
      await db.prepare('DELETE FROM inventory WHERE id = ?').run(id);
    }
    req.flash('success', `Đã xóa ${ids.length} sản phẩm.`);
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== FORM SỬA =====================
router.get('/inventory/:id/edit', ensureAuth, async (req, res, next) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) {
      req.flash('error', 'Không tìm thấy sản phẩm.');
      return res.redirect('/dashboard');
    }
    res.render('inventory_form', Object.assign({ title: 'Sửa sản phẩm', item }, await dropdownData()));
  } catch (e) { next(e); }
});

// ===================== CẬP NHẬT =====================
router.post('/inventory/:id', ensureAuth, async (req, res, next) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) {
      req.flash('error', 'Không tìm thấy sản phẩm.');
      return res.redirect('/dashboard');
    }
    const b = req.body;
    const sku = await resolveSku(b.sku, b.product_url, b.name.trim(), item.sku);
    await db.prepare(`
      UPDATE inventory SET
        sku = ?, name = ?, category_id = ?, color = ?, variant = ?, version = ?,
        cost_price = ?, sale_price = ?, supplier_id = ?,
        quantity = ?, on_order = ?, min_quantity = ?, max_quantity = ?,
        inbound_id = ?, date = ?, size = ?, weight = ?, tracking = ?, carrier = ?, eta = ?,
        product_url = ?, image_url = ?, address = ?, status = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      sku, b.name.trim(), intOrNull(b.category_id), b.color || null, b.variant || null, b.version || null,
      b.cost_price ? num(b.cost_price) : null, b.sale_price ? num(b.sale_price) : null, intOrNull(b.supplier_id),
      Math.round(num(b.quantity)), Math.round(num(b.on_order)), Math.round(num(b.min_quantity)), Math.round(num(b.max_quantity)),
      b.inbound_id || item.inbound_id, b.date || null, b.size || null, b.weight || null,
      b.tracking || null, b.carrier || null, b.eta || null, b.product_url || null, b.image_url || null,
      b.address || null, normStatus(b.status), req.params.id
    );
    req.flash('success', 'Đã cập nhật sản phẩm.');
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== NHẬP / XUẤT KHO =====================
router.post('/inventory/:id/stock', ensureAuth, async (req, res, next) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) {
      req.flash('error', 'Không tìm thấy sản phẩm.');
      return res.redirect('/dashboard');
    }
    const type = req.body.type === 'out' ? 'out' : 'in';
    const qty = Math.round(num(req.body.quantity));
    if (qty <= 0) {
      req.flash('error', 'Số lượng phải lớn hơn 0.');
      return res.redirect('/dashboard');
    }
    if (type === 'out' && qty > item.quantity) {
      req.flash('error', `Không đủ tồn kho (hiện có ${item.quantity}).`);
      return res.redirect('/dashboard');
    }

    const newQty = type === 'in' ? item.quantity + qty : item.quantity - qty;
    let newOnOrder = item.on_order;
    if (type === 'in') newOnOrder = Math.max(0, item.on_order - qty);

    await db.prepare("UPDATE inventory SET quantity = ?, on_order = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newQty, newOnOrder, item.id);
    await db.prepare('INSERT INTO transactions (inventory_id, type, quantity, note, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(item.id, type, qty, req.body.note || null, req.user.id);

    const admins = await getAdminEmails();
    if (admins.length) {
      mailer.sendStockNotification(admins.join(','), {
        type, item, quantity: qty, newQty, user: req.user.full_name || req.user.email,
      });
    }
    req.flash('success', `${type === 'in' ? 'Nhập' : 'Xuất'} ${qty} "${item.name}". Tồn kho mới: ${newQty}.`);
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== ĐỔI TRẠNG THÁI NHANH =====================
router.post('/inventory/:id/status', ensureAuth, async (req, res, next) => {
  try {
    await db.prepare("UPDATE inventory SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(normStatus(req.body.status), req.params.id);
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== XÓA (chỉ Admin) =====================
router.post('/inventory/:id/delete', ensureAdmin, async (req, res, next) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (item) {
      await db.prepare('DELETE FROM transactions WHERE inventory_id = ?').run(item.id);
      await db.prepare('DELETE FROM inventory WHERE id = ?').run(item.id);
      req.flash('success', `Đã xóa "${item.name}".`);
    }
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// ===================== LỊCH SỬ GIAO DỊCH =====================
router.get('/inventory/:id/history', ensureAuth, async (req, res, next) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) {
      req.flash('error', 'Không tìm thấy sản phẩm.');
      return res.redirect('/dashboard');
    }
    const txns = await db.prepare(`
      SELECT t.*, u.full_name, u.email
      FROM transactions t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.inventory_id = ? ORDER BY t.id DESC
    `).all(item.id);
    res.render('history', { title: 'Lịch sử: ' + item.name, item, txns });
  } catch (e) { next(e); }
});

// ===================== TRANG THỐNG KÊ =====================
router.get('/thong-ke', ensureAuth, async (req, res, next) => {
  try {
    const overview = {
      totalItems: (await db.prepare('SELECT COUNT(*) AS c FROM inventory').get()).c,
      onHand:    (await db.prepare('SELECT COALESCE(SUM(quantity),0) AS s FROM inventory').get()).s,
      onOrder:   (await db.prepare('SELECT COALESCE(SUM(on_order),0) AS s FROM inventory').get()).s,
      available: (await db.prepare('SELECT COALESCE(SUM(quantity + on_order),0) AS s FROM inventory').get()).s,
      saleValue: (await db.prepare('SELECT COALESCE(SUM(sale_price * quantity),0) AS s FROM inventory').get()).s,
      costValue: (await db.prepare('SELECT COALESCE(SUM(cost_price * quantity),0) AS s FROM inventory').get()).s,
      lowStock:  (await db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE min_quantity > 0 AND quantity <= min_quantity').get()).c,
    };
    overview.profit = Number(overview.saleValue) - Number(overview.costValue);

    const topStock = await db.prepare('SELECT name, sku, quantity FROM inventory ORDER BY quantity DESC LIMIT 8').all();

    // Top lợi nhuận tối ưu: xếp theo biên lợi nhuận (giá bán so với giá nhập)
    const topProfit = await db.prepare(`
      SELECT name, sku, cost_price, sale_price,
             (sale_price - cost_price) AS profit,
             CASE WHEN sale_price > 0 THEN (sale_price - cost_price) * 100.0 / sale_price ELSE 0 END AS margin
      FROM inventory
      WHERE cost_price IS NOT NULL AND cost_price > 0 AND sale_price IS NOT NULL AND sale_price > 0
      ORDER BY margin DESC, profit DESC LIMIT 8
    `).all();
    const topValue = await db.prepare(`
      SELECT name, sku, quantity, (COALESCE(sale_price,0) * quantity) AS total_value
      FROM inventory ORDER BY total_value DESC LIMIT 8
    `).all();

    const byCategory = await db.prepare(`
      SELECT COALESCE(c.name,'(Chưa phân loại)') AS category, COUNT(*) AS cnt, COALESCE(SUM(i.quantity),0) AS qty
      FROM inventory i LEFT JOIN categories c ON c.id = i.category_id
      GROUP BY c.name ORDER BY cnt DESC
    `).all();

    const bySupplier = await db.prepare(`
      SELECT COALESCE(s.name,'(Chưa rõ)') AS supplier, COUNT(*) AS cnt, COALESCE(SUM(i.quantity),0) AS qty
      FROM inventory i LEFT JOIN suppliers s ON s.id = i.supplier_id
      GROUP BY s.name ORDER BY cnt DESC
    `).all();

    const byDay = (await db.prepare(`
      SELECT date(created_at) AS day,
        COALESCE(SUM(CASE WHEN type='in' THEN quantity END),0) AS qin,
        COALESCE(SUM(CASE WHEN type='out' THEN quantity END),0) AS qout
      FROM transactions GROUP BY day ORDER BY day DESC LIMIT 14
    `).all()).reverse();

    const lowStock = await db.prepare(`
      SELECT name, sku, quantity, min_quantity FROM inventory
      WHERE min_quantity > 0 AND quantity <= min_quantity ORDER BY quantity ASC
    `).all();

    const recent = await db.prepare(`
      SELECT t.*, i.name AS item_name, u.full_name, u.email
      FROM transactions t
      LEFT JOIN inventory i ON i.id = t.inventory_id
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.id DESC LIMIT 10
    `).all();

    res.render('stats', { title: 'Thống kê', overview, topStock, topProfit, topValue, byCategory, bySupplier, byDay, lowStock, recent });
  } catch (e) { next(e); }
});

module.exports = router;
