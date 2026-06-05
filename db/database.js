'use strict';

// Database dùng libSQL (Turso). Chạy được cả local (file:) lẫn đám mây (libsql://).
// - Local:  TURSO_DATABASE_URL=file:./db/kho.db  (mặc định nếu không đặt)
// - Vercel: TURSO_DATABASE_URL=libsql://...turso.io  +  TURSO_AUTH_TOKEN=...
const path = require('path');

const url = process.env.TURSO_DATABASE_URL || ('file:' + path.join(__dirname, 'kho.db'));
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

// Local (file:) -> dùng bản đầy đủ (native). Đám mây (libsql://) -> dùng bản web thuần JS
// để chạy được trên Vercel serverless mà không cần thư viện native.
const { createClient } = require('@libsql/client');
const client = createClient(authToken ? { url, authToken } : { url });

// Chuẩn hóa tham số: undefined -> null (libSQL không nhận undefined)
function norm(args) {
  return (args || []).map((a) => (a === undefined ? null : a));
}

// Giữ API quen thuộc: db.prepare(sql).get/all/run(...args) — nhưng giờ là async (phải await)
function prepare(sql) {
  return {
    async get(...args) {
      const r = await client.execute({ sql, args: norm(args) });
      return r.rows[0];
    },
    async all(...args) {
      const r = await client.execute({ sql, args: norm(args) });
      return r.rows;
    },
    async run(...args) {
      const r = await client.execute({ sql, args: norm(args) });
      return {
        lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
        changes: Number(r.rowsAffected || 0),
      };
    },
  };
}

async function exec(sql) {
  await client.execute(sql);
}

// --- Tạo bảng + migration (chạy 1 lần khi khởi động) ---
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    full_name TEXT,
    google_id TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'staff',
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_id TEXT, date TEXT, name TEXT NOT NULL, size TEXT, weight TEXT, sku TEXT,
    quantity INTEGER NOT NULL DEFAULT 0, value REAL, storage_type TEXT,
    tracking TEXT, carrier TEXT, eta TEXT, image_url TEXT,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    note TEXT,
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, phone TEXT, email TEXT, address TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  )`,
];

async function ensureColumn(table, column, definition) {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  if (!r.rows.some((c) => c.name === column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (!process.env.QUIET_DB) console.log(`[DB] Đã thêm cột ${table}.${column}`);
    return true;
  }
  return false;
}

async function init() {
  for (const stmt of SCHEMA) await client.execute(stmt);

  await ensureColumn('users', 'totp_secret', 'TEXT');
  await ensureColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');

  await ensureColumn('inventory', 'product_url', 'TEXT');
  await ensureColumn('inventory', 'category_id', 'INTEGER');
  await ensureColumn('inventory', 'supplier_id', 'INTEGER');
  await ensureColumn('inventory', 'color', 'TEXT');
  await ensureColumn('inventory', 'variant', 'TEXT');
  await ensureColumn('inventory', 'version', 'TEXT');
  await ensureColumn('inventory', 'cost_price', 'REAL');
  const addedSalePrice = await ensureColumn('inventory', 'sale_price', 'REAL');
  await ensureColumn('inventory', 'original_price', 'REAL'); // Giá gốc (lấy từ link sản phẩm)
  await ensureColumn('inventory', 'on_order', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('inventory', 'max_quantity', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('inventory', 'address', 'TEXT');                    // Địa chỉ (Add)
  await ensureColumn('inventory', "status", "TEXT NOT NULL DEFAULT 'Chờ xử lý'"); // Trạng thái
  const addedCategoryText = await ensureColumn('inventory', 'category', 'TEXT'); // Danh mục (lưu tên trực tiếp)
  // Chuyển danh mục cũ (category_id -> tên) sang cột category text
  if (addedCategoryText) {
    try {
      await client.execute('UPDATE inventory SET category = (SELECT name FROM categories WHERE id = inventory.category_id) WHERE category IS NULL AND category_id IS NOT NULL');
    } catch (e) { /* bỏ qua */ }
  }

  if (addedSalePrice) {
    try {
      await client.execute('UPDATE inventory SET sale_price = value WHERE sale_price IS NULL AND value IS NOT NULL');
    } catch (e) { /* cột value có thể không tồn tại */ }
  }

  if (!process.env.QUIET_DB) console.log('[DB] Sẵn sàng.');
}

// Promise đảm bảo schema đã tạo xong trước khi xử lý request
const ready = init();

module.exports = { prepare, exec, client, ready };
