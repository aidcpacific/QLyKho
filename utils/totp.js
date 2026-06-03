'use strict';

const otplib = require('otplib');
const QRCode = require('qrcode');

const ISSUER = process.env.APP_NAME || 'Quản Lý Kho';

// Tạo mã bí mật (base32) cho người dùng
function generateSecret() {
  return otplib.generateSecret();
}

// Kiểm tra mã 6 số người dùng nhập có khớp không
async function verifyToken(secret, token) {
  if (!secret || !token) return false;
  try {
    const result = await otplib.verify({ secret, token: String(token).replace(/\s/g, '') });
    return !!(result && result.valid);
  } catch (e) {
    return false;
  }
}

// Tạo URI otpauth:// để app Authenticator quét
function otpauthUri(label, secret) {
  return otplib.generateURI({ issuer: ISSUER, label, secret });
}

// Tạo ảnh QR (data URL) từ URI
async function qrDataUrl(uri) {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

module.exports = { generateSecret, verifyToken, otpauthUri, qrDataUrl, ISSUER };
