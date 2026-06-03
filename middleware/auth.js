'use strict';

// Yêu cầu đã đăng nhập
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.flash('error', 'Vui lòng đăng nhập để tiếp tục.');
  return res.redirect('/login');
}

// Yêu cầu vai trò admin
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user.role === 'admin') return next();
  if (req.isAuthenticated && req.isAuthenticated()) {
    req.flash('error', 'Bạn không có quyền thực hiện thao tác này (chỉ Admin).');
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
}

// Nếu đã đăng nhập rồi thì không cho vào trang login/register nữa
function forwardAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  return next();
}

module.exports = { ensureAuth, ensureAdmin, forwardAuthenticated };
