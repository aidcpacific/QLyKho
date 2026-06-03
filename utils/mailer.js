'use strict';

const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const APP_NAME = process.env.APP_NAME || 'Quản Lý Kho';

// Nếu chưa cấu hình Gmail, mailer sẽ chạy ở chế độ "ghi log ra màn hình"
// để bạn vẫn lấy được link xác thực / đặt lại mật khẩu khi phát triển.
const isConfigured = Boolean(GMAIL_USER && GMAIL_PASS);

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

/**
 * Gửi email. Nếu chưa cấu hình SMTP thì in nội dung ra console (không làm crash app).
 */
async function sendMail({ to, subject, html, text }) {
  if (!isConfigured) {
    console.log('\n========== [EMAIL - CHẾ ĐỘ DEV, CHƯA CẤU HÌNH GMAIL] ==========');
    console.log('Gửi tới :', to);
    console.log('Tiêu đề :', subject);
    console.log('Nội dung:', text || html);
    console.log('================================================================\n');
    return { dev: true };
  }
  try {
    const info = await transporter.sendMail({
      from: `"${APP_NAME}" <${GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    console.log('Đã gửi email tới', to, '| id:', info.messageId);
    return info;
  } catch (err) {
    console.error('LỖI gửi email tới', to, ':', err.message);
    // Không ném lỗi để không chặn luồng chính (vd: đăng ký vẫn thành công)
    return { error: err.message };
  }
}

function baseTemplate(title, bodyHtml) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden">
    <div style="background:#0d6efd;color:#fff;padding:20px 24px;font-size:20px;font-weight:bold">${APP_NAME}</div>
    <div style="padding:24px;color:#333;line-height:1.6">
      <h2 style="margin-top:0">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="background:#f8f9fa;color:#888;padding:14px 24px;font-size:12px">
      Email tự động từ hệ thống ${APP_NAME}. Vui lòng không trả lời email này.
    </div>
  </div>`;
}

// 1) Email xác nhận đăng ký
async function sendVerificationEmail(to, link) {
  const html = baseTemplate('Xác nhận đăng ký tài khoản', `
    <p>Cảm ơn bạn đã đăng ký! Nhấn nút bên dưới để kích hoạt tài khoản:</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${link}" style="background:#0d6efd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">Kích hoạt tài khoản</a>
    </p>
    <p style="font-size:13px;color:#666">Hoặc mở liên kết: <br>${link}</p>
    <p style="font-size:13px;color:#666">Liên kết có hiệu lực trong 24 giờ.</p>
  `);
  return sendMail({ to, subject: `[${APP_NAME}] Xác nhận đăng ký tài khoản`, html,
    text: `Kích hoạt tài khoản của bạn: ${link}` });
}

// 1b) Email chào mừng / thông báo đăng ký thành công (khi không bắt xác minh)
async function sendWelcomeEmail(to, { full_name, email, role, loginUrl }) {
  const roleText = role === 'admin' ? 'Quản trị viên (Admin)' : 'Nhân viên';
  const html = baseTemplate('Đăng ký tài khoản thành công 🎉', `
    <p>Chào <b>${full_name || email}</b>,</p>
    <p>Tài khoản của bạn tại hệ thống <b>${APP_NAME}</b> đã được tạo thành công. Dưới đây là thông tin tài khoản:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr><td style="padding:6px 0;color:#666;width:140px">Email đăng nhập</td><td><b>${email}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">Phân quyền</td><td>${roleText}</td></tr>
    </table>
    <p style="text-align:center;margin:24px 0">
      <a href="${loginUrl}" style="background:#0d6efd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">Đăng nhập ngay</a>
    </p>
    <p style="font-size:13px;color:#666">Nếu bạn không thực hiện đăng ký này, vui lòng bỏ qua email.</p>
  `);
  return sendMail({ to, subject: `[${APP_NAME}] Đăng ký tài khoản thành công`, html,
    text: `Chào ${full_name || email}, tài khoản (${email}) đã được tạo thành công. Đăng nhập: ${loginUrl}` });
}

// 2) Email quên mật khẩu
async function sendResetPasswordEmail(to, link) {
  const html = baseTemplate('Đặt lại mật khẩu', `
    <p>Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới:</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${link}" style="background:#dc3545;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">Đặt lại mật khẩu</a>
    </p>
    <p style="font-size:13px;color:#666">Hoặc mở liên kết: <br>${link}</p>
    <p style="font-size:13px;color:#666">Liên kết có hiệu lực trong 1 giờ. Nếu không phải bạn, hãy bỏ qua email này.</p>
  `);
  return sendMail({ to, subject: `[${APP_NAME}] Yêu cầu đặt lại mật khẩu`, html,
    text: `Đặt lại mật khẩu: ${link}` });
}

// 3) Email thông báo nhập/xuất kho (gửi cho admin)
async function sendStockNotification(to, { type, item, quantity, user, newQty }) {
  const action = type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO';
  const color = type === 'in' ? '#198754' : '#fd7e14';
  const html = baseTemplate(`Thông báo ${action}`, `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">Hành động</td><td style="font-weight:bold;color:${color}">${action}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Sản phẩm</td><td><b>${item.name}</b> (SKU: ${item.sku || '-'})</td></tr>
      <tr><td style="padding:6px 0;color:#666">Số lượng</td><td>${quantity}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Tồn kho mới</td><td><b>${newQty}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">Người thực hiện</td><td>${user}</td></tr>
    </table>
    ${newQty <= (item.min_quantity || 0) ? `<p style="color:#dc3545;font-weight:bold;margin-top:16px">⚠ Cảnh báo: tồn kho đã ở mức thấp (≤ ${item.min_quantity})!</p>` : ''}
  `);
  return sendMail({ to, subject: `[${APP_NAME}] ${action}: ${item.name} (${quantity})`, html,
    text: `${action} ${quantity} x ${item.name}. Tồn kho mới: ${newQty}. Người thực hiện: ${user}` });
}

module.exports = {
  isConfigured,
  sendMail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
  sendStockNotification,
};
