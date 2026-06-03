'use strict';

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('../db/database');

// Chỉ bật Google OAuth khi đã có credentials trong .env
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

// Có bắt buộc xác minh email trước khi đăng nhập không
const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

// --- Chiến lược đăng nhập bằng Email HOẶC Username + mật khẩu ---
passport.use(new LocalStrategy(
  { usernameField: 'login', passwordField: 'password' }, // 'login' = email hoặc username
  async (login, password, done) => {
    try {
      const user = await db.prepare(
        'SELECT * FROM users WHERE email = ? OR username = ?'
      ).get(login.trim().toLowerCase(), login.trim());

      if (!user) return done(null, false, { message: 'Tài khoản không tồn tại.' });
      if (!user.password_hash) {
        return done(null, false, { message: 'Tài khoản này đăng nhập bằng Google. Vui lòng dùng nút Google.' });
      }
      const ok = bcrypt.compareSync(password, user.password_hash);
      if (!ok) return done(null, false, { message: 'Mật khẩu không đúng.' });
      if (requireEmailVerification && !user.email_verified) {
        return done(null, false, { message: 'Tài khoản chưa được xác thực email. Vui lòng kiểm tra hộp thư.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// --- Chiến lược đăng nhập bằng Google ---
if (googleEnabled) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: (process.env.BASE_URL || 'http://localhost:3000') + '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails && profile.emails[0] && profile.emails[0].value || '').toLowerCase();
        const googleId = profile.id;

        // Đã có tài khoản theo google_id?
        let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
        if (user) return done(null, user);

        // Đã có email -> liên kết google_id vào tài khoản đó
        user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (user) {
          await db.prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?')
            .run(googleId, user.id);
          user.google_id = googleId;
          user.email_verified = 1;
          return done(null, user);
        }

        // Tạo mới. Người dùng đầu tiên trong hệ thống là admin.
        const count = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
        const role = Number(count) === 0 ? 'admin' : 'staff';
        const info = await db.prepare(`
          INSERT INTO users (email, full_name, google_id, role, email_verified)
          VALUES (?, ?, ?, ?, 1)
        `).run(email, profile.displayName || email, googleId, role);
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.prepare('SELECT id, username, email, full_name, role, email_verified FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = { passport, googleEnabled };
