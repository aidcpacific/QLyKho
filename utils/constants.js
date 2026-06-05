'use strict';

// Danh sách danh mục mặc định (cố định) — dùng cho dropdown khi thêm/sửa sản phẩm.
const DEFAULT_CATEGORIES = [
  'Điện tử',
  'Máy ảnh & Quay phim',
  'Điện thoại & Phụ kiện',
  'Máy tính & Laptop',
  'Đồ chơi & Trò chơi',
  'Game & Máy chơi game',
  'Sách & Văn phòng phẩm',
  'Thực phẩm & Đồ uống',
  'Sức khỏe & Làm đẹp',
  'Mẹ & Bé',
  'Thời trang & Phụ kiện',
  'Nhà cửa & Đời sống',
  'Gia dụng',
  'Thể thao & Dã ngoại',
  'Khác',
];

// Danh sách trạng thái đơn hàng/kho (cố định) + lớp CSS màu tương ứng.
const PRODUCT_STATUSES = [
  'NEW', 'PROCES', 'PREPRING', 'SHIPPED', 'DELI',
  'XIN HỦY', 'HỦY', 'RETURN', 'ĐÃ BANK CO', 'da nhan',
  'Het cmn h leu leu', 'hết hàng',
];

const STATUS_CLASS = {
  'NEW': 'st-new',
  'PROCES': 'st-proc',
  'PREPRING': 'st-prep',
  'SHIPPED': 'st-ship',
  'DELI': 'st-deli',
  'XIN HỦY': 'st-cancelreq',
  'HỦY': 'st-cancel',
  'RETURN': 'st-return',
  'ĐÃ BANK CO': 'st-bank',
  'da nhan': 'st-received',
  'Het cmn h leu leu': 'st-funny',
  'hết hàng': 'st-out',
};

module.exports = { DEFAULT_CATEGORIES, PRODUCT_STATUSES, STATUS_CLASS };
