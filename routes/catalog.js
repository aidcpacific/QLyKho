'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');

// ===================== DANH MỤC =====================
router.get('/danh-muc', ensureAuth, async (req, res, next) => {
  try {
    const categories = await db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM inventory i WHERE i.category_id = c.id) AS product_count
      FROM categories c ORDER BY c.name
    `).all();
    res.render('categories', { title: 'Danh mục sản phẩm', categories });
  } catch (e) { next(e); }
});

router.post('/danh-muc', ensureAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const note = (req.body.note || '').trim() || null;
  if (!name) {
    req.flash('error', 'Tên danh mục là bắt buộc.');
    return res.redirect('/danh-muc');
  }
  try {
    await db.prepare('INSERT INTO categories (name, note) VALUES (?, ?)').run(name, note);
    req.flash('success', `Đã thêm danh mục "${name}".`);
  } catch (e) {
    req.flash('error', /UNIQUE/i.test(e.message) ? 'Danh mục này đã tồn tại.' : 'Lỗi: ' + e.message);
  }
  res.redirect('/danh-muc');
});

router.post('/danh-muc/:id', ensureAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const note = (req.body.note || '').trim() || null;
  if (name) {
    try {
      await db.prepare('UPDATE categories SET name = ?, note = ? WHERE id = ?').run(name, note, req.params.id);
      req.flash('success', 'Đã cập nhật danh mục.');
    } catch (e) {
      req.flash('error', /UNIQUE/i.test(e.message) ? 'Tên danh mục bị trùng.' : 'Lỗi: ' + e.message);
    }
  }
  res.redirect('/danh-muc');
});

router.post('/danh-muc/:id/delete', ensureAdmin, async (req, res, next) => {
  try {
    await db.prepare('UPDATE inventory SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    req.flash('success', 'Đã xóa danh mục. Sản phẩm thuộc danh mục này sẽ về "Chưa phân loại".');
    res.redirect('/danh-muc');
  } catch (e) { next(e); }
});

// ===================== NHÀ CUNG CẤP =====================
router.get('/nha-cung-cap', ensureAuth, async (req, res, next) => {
  try {
    const suppliers = await db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM inventory i WHERE i.supplier_id = s.id) AS product_count
      FROM suppliers s ORDER BY s.name
    `).all();
    res.render('suppliers', { title: 'Nhà Kho', suppliers });
  } catch (e) { next(e); }
});

router.post('/nha-cung-cap', ensureAuth, async (req, res) => {
  const b = req.body;
  const name = (b.name || '').trim();
  if (!name) {
    req.flash('error', 'Tên nhà kho là bắt buộc.');
    return res.redirect('/nha-cung-cap');
  }
  try {
    await db.prepare('INSERT INTO suppliers (name, phone, email, address, note) VALUES (?, ?, ?, ?, ?)')
      .run(name, b.phone || null, b.email || null, b.address || null, b.note || null);
    req.flash('success', `Đã thêm nhà kho "${name}".`);
  } catch (e) {
    req.flash('error', /UNIQUE/i.test(e.message) ? 'Nhà cung cấp này đã tồn tại.' : 'Lỗi: ' + e.message);
  }
  res.redirect('/nha-cung-cap');
});

router.post('/nha-cung-cap/:id', ensureAuth, async (req, res) => {
  const b = req.body;
  const name = (b.name || '').trim();
  if (name) {
    try {
      await db.prepare('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, note = ? WHERE id = ?')
        .run(name, b.phone || null, b.email || null, b.address || null, b.note || null, req.params.id);
      req.flash('success', 'Đã cập nhật nhà kho.');
    } catch (e) {
      req.flash('error', /UNIQUE/i.test(e.message) ? 'Tên nhà kho bị trùng.' : 'Lỗi: ' + e.message);
    }
  }
  res.redirect('/nha-cung-cap');
});

router.post('/nha-cung-cap/:id/delete', ensureAdmin, async (req, res, next) => {
  try {
    await db.prepare('UPDATE inventory SET supplier_id = NULL WHERE supplier_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
    req.flash('success', 'Đã xóa nhà kho.');
    res.redirect('/nha-cung-cap');
  } catch (e) { next(e); }
});

module.exports = router;
