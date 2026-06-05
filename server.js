'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const { passport } = require('./config/passport');
const db = require('./db/database');
const createLibsqlStore = require('./utils/sessionStore');

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const catalogRoutes = require('./routes/catalog');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'Quản Lý Kho';
const isProd = process.env.NODE_ENV === 'production';

// Sau proxy (Vercel/Render) để cookie secure + HTTPS hoạt động đúng
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static + body parser
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Đảm bảo database (tạo bảng) sẵn sàng trước khi xử lý request — quan trọng cho serverless
app.use(async (req, res, next) => {
  try { await db.ready; next(); } catch (e) { next(e); }
});

// Chống cache cho các trang động (HTML) để không bị hiển thị bản cũ.
// (File tĩnh CSS đã được phục vụ ở trên nên không bị ảnh hưởng.)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// Session (lưu vào DB để chạy được trên serverless)
app.use(session({
  store: createLibsqlStore(),
  secret: process.env.SESSION_SECRET || 'doi-secret-nay-trong-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 ngày
    httpOnly: true,
    secure: isProd, // bật secure khi chạy production (HTTPS)
    sameSite: 'lax',
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());

// Biến dùng chung cho mọi view
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.messages = { success: req.flash('success'), error: req.flash('error') };
  res.locals.appName = APP_NAME;
  next();
});

// Routes
app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));
app.use('/', authRoutes);
app.use('/', inventoryRoutes);
app.use('/', catalogRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('login', { title: 'Không tìm thấy', googleEnabled: require('./config/passport').googleEnabled });
});

// Xử lý lỗi
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Lỗi máy chủ: ' + (err && err.message ? err.message : 'unknown'));
});

// Chỉ tự chạy server khi gọi trực tiếp (node server.js).
// Trên Vercel, file api/index.js sẽ require app này (không listen).
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n✅ ${APP_NAME} đang chạy tại: http://localhost:${PORT}`);
    console.log(`   Database: ${process.env.TURSO_DATABASE_URL ? 'Turso/libSQL từ env' : 'file local (db/kho.db)'}`);
    console.log(`   Email Gmail: ${require('./utils/mailer').isConfigured ? 'ĐÃ cấu hình' : 'CHƯA cấu hình (in link ra console)'}`);
    console.log(`   Google OAuth: ${require('./config/passport').googleEnabled ? 'ĐÃ bật' : 'CHƯA bật'}\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Cổng ${PORT} đang bị chiếm. Đóng server cũ hoặc đổi PORT trong .env rồi chạy lại.\n`);
    } else {
      console.error('\n❌ Lỗi khởi động server:', err.message, '\n');
    }
    process.exit(1);
  });
}

module.exports = app;
