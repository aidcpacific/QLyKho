'use strict';

// Công cụ kiểm tra cấu hình Gmail.
// Cách dùng:  node test-email.js  hoặc  node test-email.js dia-chi-nhan@gmail.com
require('dotenv').config();
const mailer = require('./utils/mailer');

const to = process.argv[2] || process.env.GMAIL_USER;

(async () => {
  console.log('--- Kiểm tra gửi email ---');
  if (!mailer.isConfigured) {
    console.log('❌ Chưa cấu hình Gmail. Hãy điền GMAIL_USER và GMAIL_APP_PASSWORD trong file .env rồi thử lại.');
    console.log('   (Hiện email chỉ được in ra console, không gửi thật.)');
    process.exit(1);
  }
  if (!to) {
    console.log('❌ Không có địa chỉ nhận. Dùng: node test-email.js email-cua-ban@gmail.com');
    process.exit(1);
  }
  console.log('Đang gửi email thử tới:', to, '...');
  const info = await mailer.sendMail({
    to,
    subject: '[Quản Lý Kho] Email thử nghiệm ✔',
    text: 'Nếu bạn nhận được email này, cấu hình Gmail đã hoạt động.',
    html: '<h2>✅ Cấu hình Gmail thành công!</h2><p>Nếu bạn nhận được email này, hệ thống đã gửi email thật được rồi.</p>',
  });
  if (info && info.error) {
    console.log('❌ Gửi thất bại:', info.error);
    console.log('   Gợi ý: kiểm tra lại App Password (16 ký tự, không phải mật khẩu Gmail thường) và đã bật Xác minh 2 bước.');
    process.exit(1);
  }
  console.log('✅ Đã gửi! Kiểm tra hộp thư (cả mục Spam) của:', to);
  process.exit(0);
})();
