'use strict';

// Thứ tự cột chuẩn dùng cho cả xuất và nhập
const COLUMNS = [
  // --- Quản lý sản phẩm ---
  { key: 'sku',          label: 'SKU' },
  { key: 'name',         label: 'Tên sản phẩm' },
  { key: 'category',     label: 'Danh mục' },
  { key: 'color',        label: 'Màu sắc' },
  { key: 'variant',      label: 'Kích thước/Biến thể' },
  { key: 'version',      label: 'Phiên bản' },
  { key: 'cost_price',   label: 'Giá nhập' },
  { key: 'sale_price',   label: 'Giá bán' },
  { key: 'supplier',     label: 'Nhà cung cấp' },
  // --- Quản lý tồn kho ---
  { key: 'quantity',     label: 'Số lượng hiện có' },
  { key: 'on_order',     label: 'Đã đặt hàng' },
  { key: 'min_quantity', label: 'Tồn tối thiểu' },
  { key: 'max_quantity', label: 'Tồn tối đa' },
  // --- Vận chuyển / Nhập hàng ---
  { key: 'inbound_id',   label: 'Inbound ID' },
  { key: 'date',         label: 'Date' },
  { key: 'size',         label: 'Kích thước kiện' },
  { key: 'weight',       label: 'Trọng lượng' },
  { key: 'tracking',     label: 'Tracking number' },
  { key: 'carrier',      label: 'Đơn vị vận chuyển' },
  { key: 'eta',          label: 'Ngày đến dự kiến' },
  { key: 'product_url',  label: 'Link sản phẩm' },
  { key: 'image_url',    label: 'Hình ảnh sản phẩm' },
  { key: 'address',      label: 'Địa chỉ' },
  { key: 'status',       label: 'Trạng thái' },
];

// Bọc một ô CSV (thêm dấu ngoặc kép nếu chứa dấu phẩy, ngoặc kép hoặc xuống dòng)
function escapeCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Tạo nội dung CSV từ mảng object inventory. Có BOM để Excel/Sheets đọc đúng tiếng Việt.
function toCsv(items) {
  const header = COLUMNS.map((c) => escapeCell(c.label)).join(',');
  const lines = items.map((it) =>
    COLUMNS.map((c) => escapeCell(it[c.key])).join(',')
  );
  return '﻿' + [header, ...lines].join('\r\n');
}

// Phân tích văn bản dạng bảng. Tự nhận dấu phân cách: Tab (dán từ Sheet) hoặc dấu phẩy (CSV).
// Trả về mảng các mảng ô (string).
function parseTable(text) {
  if (!text) return [];
  const str = String(text).replace(/^﻿/, ''); // bỏ BOM nếu có
  // Nếu có ký tự Tab -> dùng Tab; ngược lại dùng dấu phẩy
  const delim = str.includes('\t') ? '\t' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuotes) {
      if (ch === '"') {
        if (str[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch === '\r') {
      // bỏ qua, sẽ xử lý ở \n
    } else {
      cell += ch;
    }
  }
  // ô/dòng cuối
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  // Bỏ các dòng trống hoàn toàn
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Một dòng có phải dòng tiêu đề không (để bỏ qua khi nhập)
function looksLikeHeader(row) {
  const joined = row.join(' ').toLowerCase();
  return joined.includes('sku') || joined.includes('tên sản phẩm') ||
         joined.includes('inbound') || joined.includes('name');
}

module.exports = { COLUMNS, toCsv, parseTable, looksLikeHeader };
