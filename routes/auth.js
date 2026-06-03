'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();

const db = require('../db/database');
const { passport, googleEnabled } = require('../config/passport');
const { forwardAuthenticated, ensureAuth } = require('../middleware/auth');
const mailer = require('../utils/mailer');
const totp = require('../utils/totp');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function plusHours(h) {
  const d = new Date(Date.now() + h * 3600 * 1000);
  return d.toISOString();
}

// ===================== ĐĂNG KÝ =====================
router.get('/register', forwardAuthenticated, (req, res) => {
  res.render('register', { title: 'Đăng ký', googleEnabled });
});

router.post('/register', forwardAuthenticated, async (req, res) => {
  try {
    let { full_name, username, email, password, password2 } = req.body;
    email = (email || '').trim().toLowerCase();
    username = (username || '').trim();

    const errors = [];
    if (!full_name || !email || !password) errors.push('Vui lòng điền đầy đủ họ tên, email và mật khẩu.');
    if (password && password.length < 6) errors.push('Mật khẩu phải có ít nhất 6 ký tự.');
    if (password !== password2) errors.push('Mật khẩu nhập lại không khớp.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Email không hợp lệ.');

    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) errors.push('Email đã được sử dụng.');
    if (username && await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) errors.push('Tên đăng nhập đã tồn tại.');

    if (errors.length) {
      return res.status(400).render('register', { title: 'Đăng ký', googleEnabled, errors, form: req.body });
    }

    // Người dùng đầu tiên là admin
    const count = Number((await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c);
    const role = count === 0 ? 'admin' : 'staff';
    const hash = bcrypt.hashSync(password, 10);

    // Tạo sẵn mã bí mật 2FA cho tài khoản (bật sau khi người dùng xác nhận quét QR)
    const secret = totp.generateSecret();
    const info = await db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, role, email_verified, totp_secret, totp_enabled)
      VALUES (?, ?, ?, ?, ?, 1, ?, 0)
    `).run(username || null, email, hash, full_name, role, secret);

    // Chuyển sang bước thiết lập 2FA (quét QR rồi nhập mã xác nhận)
    req.session.pending_2fa_user = info.lastInsertRowid;
    req.flash('success', 'Đăng ký thành công! Hãy thiết lập xác thực 2 lớp (2FA) bên dưới.');
    res.redirect('/setup-2fa');
  } catch (err) {
    console.error('Lỗi đăng ký:', err);
    res.status(500).render('register', { title: 'Đăng ký', googleEnabled,
      errors: ['Có lỗi xảy ra, vui lòng thử lại.'], form: req.body });
  }
});

// ===================== XÁC THỰC EMAIL =====================
router.get('/auth/verify', async (req, res, next) => {
  try {
    const { token } = req.query;
    const row = await db.prepare("SELECT * FROM tokens WHERE token = ? AND type = 'verify'").get(token || '');
    if (!row || new Date(row.expires_at) < new Date()) {
      req.flash('error', 'Liên kết xác thực không hợp lệ hoặc đã hết hạn.');
      return res.redirect('/login');
    }
    await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
    await db.prepare('DELETE FROM tokens WHERE id = ?').run(row.id);
    req.flash('success', 'Kích hoạt tài khoản thành công! Bạn có thể đăng nhập.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

// ===================== ĐĂNG NHẬP =====================
router.get('/login', forwardAuthenticated, (req, res) => {
  res.render('login', { title: 'Đăng nhập', googleEnabled });
});

router.post('/login', forwardAuthenticated, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', (info && info.message) || 'Đăng nhập thất bại.');
      return res.redirect('/login');
    }
    // Mọi lần đăng nhập đều phải qua 2FA.
    if (user.totp_enabled) {
      req.session.tfa_user_id = user.id;
      return res.redirect('/login/2fa');
    }
    // Chưa bật 2FA -> bắt thiết lập trước khi được vào
    req.session.pending_2fa_user = user.id;
    req.flash('error', 'Tài khoản chưa bật xác thực 2 lớp. Vui lòng thiết lập 2FA để tiếp tục đăng nhập.');
    return res.redirect('/setup-2fa');
  })(req, res, next);
});

// ----- Bước 2: nhập mã 2FA -----
router.get('/login/2fa', forwardAuthenticated, (req, res) => {
  if (!req.session.tfa_user_id) return res.redirect('/login');
  res.render('login_2fa', { title: 'Xác thực 2 lớp' });
});

router.post('/login/2fa', forwardAuthenticated, async (req, res, next) => {
  try {
    const uid = req.session.tfa_user_id;
    if (!uid) return res.redirect('/login');
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) {
      delete req.session.tfa_user_id;
      return res.redirect('/login');
    }
    const ok = await totp.verifyToken(user.totp_secret, req.body.code);
    if (!ok) {
      req.flash('error', 'Mã 2FA không đúng hoặc đã hết hạn. Vui lòng thử lại.');
      return res.redirect('/login/2fa');
    }
    delete req.session.tfa_user_id;
    req.logIn(user, (err) => {
      if (err) return next(err);
      req.flash('success', `Xin chào ${user.full_name || user.username || user.email}!`);
      res.redirect('/dashboard');
    });
  } catch (e) { next(e); }
});

// ===================== THIẾT LẬP 2FA =====================
async function loadSetupUser(req) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id), pending: false };
  }
  if (req.session.pending_2fa_user) {
    return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pending_2fa_user), pending: true };
  }
  return { user: null, pending: false };
}

router.get('/setup-2fa', async (req, res, next) => {
  try {
    const { user, pending } = await loadSetupUser(req);
    if (!user) return res.redirect('/login');

    if (!user.totp_secret) {
      const secret = totp.generateSecret();
      await db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
      user.totp_secret = secret;
    }
    const uri = totp.otpauthUri(user.email, user.totp_secret);
    const qr = await totp.qrDataUrl(uri);
    res.render('setup_2fa', {
      title: 'Thiết lập 2FA',
      secret: user.totp_secret,
      qr,
      enabled: !!user.totp_enabled,
      pending,
    });
  } catch (e) { next(e); }
});

router.post('/setup-2fa', async (req, res, next) => {
  try {
    const { user, pending } = await loadSetupUser(req);
    if (!user) return res.redirect('/login');

    const ok = await totp.verifyToken(user.totp_secret, req.body.code);
    if (!ok) {
      req.flash('error', 'Mã không đúng. Hãy nhập mã 6 số đang hiển thị trong app Authenticator.');
      return res.redirect('/setup-2fa');
    }
    await db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);

    if (pending) {
      delete req.session.pending_2fa_user;
      req.flash('success', 'Đã bật 2FA! Giờ hãy đăng nhập bằng tài khoản và mã 2FA.');
      return res.redirect('/login');
    }
    req.flash('success', 'Đã bật xác thực 2 lớp cho tài khoản của bạn.');
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

// Tắt 2FA (phải đang đăng nhập)
router.post('/setup-2fa/disable', ensureAuth, async (req, res, next) => {
  try {
    await db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = ?').run(req.user.id);
    req.flash('success', 'Đã tắt xác thực 2 lớp.');
    res.redirect('/setup-2fa');
  } catch (e) { next(e); }
});

// ===================== GOOGLE OAUTH =====================
if (googleEnabled) {
  router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', failureFlash: 'Đăng nhập Google thất bại.' }),
    (req, res) => {
      req.flash('success', `Xin chào ${req.user.full_name || req.user.email}!`);
      res.redirect('/dashboard');
    });
}

// ===================== ĐĂNG XUẤT =====================
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'Đã đăng xuất.');
    res.redirect('/login');
  });
});

// ===================== QUÊN MẬT KHẨU =====================
router.get('/forgot', forwardAuthenticated, (req, res) => {
  res.render('forgot', { title: 'Quên mật khẩu' });
});

router.post('/forgot', forwardAuthenticated, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user && user.password_hash) {
      await db.prepare("DELETE FROM tokens WHERE user_id = ? AND type = 'reset'").run(user.id);
      const token = makeToken();
      await db.prepare('INSERT INTO tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
        .run(user.id, token, 'reset', plusHours(1));
      const link = `${BASE_URL}/reset?token=${token}`;
      await mailer.sendResetPasswordEmail(email, link);
      if (!mailer.isConfigured) {
        req.flash('success', `Đã tạo yêu cầu. (Chế độ dev — link đặt lại: ${link})`);
        return res.redirect('/login');
      }
    }
    req.flash('success', 'Nếu email tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

router.get('/reset', forwardAuthenticated, async (req, res, next) => {
  try {
    const { token } = req.query;
    const row = await db.prepare("SELECT * FROM tokens WHERE token = ? AND type = 'reset'").get(token || '');
    if (!row || new Date(row.expires_at) < new Date()) {
      req.flash('error', 'Liên kết đặt lại không hợp lệ hoặc đã hết hạn.');
      return res.redirect('/forgot');
    }
    res.render('reset', { title: 'Đặt lại mật khẩu', token });
  } catch (e) { next(e); }
});

router.post('/reset', forwardAuthenticated, async (req, res, next) => {
  try {
    const { token, password, password2 } = req.body;
    const row = await db.prepare("SELECT * FROM tokens WHERE token = ? AND type = 'reset'").get(token || '');
    if (!row || new Date(row.expires_at) < new Date()) {
      req.flash('error', 'Liên kết đặt lại không hợp lệ hoặc đã hết hạn.');
      return res.redirect('/forgot');
    }
    if (!password || password.length < 6) {
      req.flash('error', 'Mật khẩu phải có ít nhất 6 ký tự.');
      return res.redirect('/reset?token=' + token);
    }
    if (password !== password2) {
      req.flash('error', 'Mật khẩu nhập lại không khớp.');
      return res.redirect('/reset?token=' + token);
    }
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, row.user_id);
    await db.prepare('DELETE FROM tokens WHERE id = ?').run(row.id);
    req.flash('success', 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

module.exports = router;
