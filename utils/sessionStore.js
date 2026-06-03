'use strict';

// Session store lưu vào database (libSQL/Turso) — hoạt động tốt trên serverless (Vercel),
// không bị rớt đăng nhập như MemoryStore khi chạy nhiều tiến trình.
const session = require('express-session');
const db = require('../db/database');

module.exports = function createLibsqlStore() {
  const Store = session.Store;

  class LibsqlStore extends Store {
    get(sid, cb) {
      db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid)
        .then((row) => {
          if (!row) return cb(null, null);
          if (row.expire && Number(row.expire) < Date.now()) {
            // Hết hạn -> xóa
            return db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
              .then(() => cb(null, null)).catch(() => cb(null, null));
          }
          try { cb(null, JSON.parse(row.sess)); }
          catch (e) { cb(e); }
        })
        .catch(cb);
    }

    set(sid, sess, cb) {
      const expire = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 3600 * 1000;
      const data = JSON.stringify(sess);
      db.prepare(`
        INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `).run(sid, data, expire)
        .then(() => cb && cb(null)).catch((e) => cb && cb(e));
    }

    destroy(sid, cb) {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
        .then(() => cb && cb(null)).catch((e) => cb && cb(e));
    }

    touch(sid, sess, cb) {
      const expire = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 3600 * 1000;
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid)
        .then(() => cb && cb(null)).catch(() => cb && cb(null));
    }
  }

  return new LibsqlStore();
};
