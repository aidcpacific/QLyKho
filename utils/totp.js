'use strict';

const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const ISSUER = process.env.APP_NAME || 'Quản Lý Kho';

function generateSecret() {
  return authenticator.generateSecret();
}

function verifyToken(secret, token) {
  if (!secret || !token) return false;
  try {
    return authenticator.verify({ secret, token: String(token).replace(/\s/g, '') });
  } catch (e) {
    return false;
  }
}

function otpauthUri(label, secret) {
  return authenticator.keyuri(label, ISSUER, secret);
}

async function qrDataUrl(uri) {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

module.exports = { generateSecret, verifyToken, otpauthUri, qrDataUrl, ISSUER };