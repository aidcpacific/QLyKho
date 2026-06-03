# 🚀 Hướng dẫn đưa web lên mạng (Vercel + Turso)

Mục tiêu: ai cũng vào được qua `https://quanlykhohang.vercel.app` (về sau gắn `quanlykho.com`).

App này dùng **Turso** (database đám mây, miễn phí) để lưu dữ liệu, vì Vercel không lưu được file.
Chạy local thì không cần Turso (tự dùng file `db/kho.db`).

---

## Bước 1 — Đưa code lên GitHub

1. Tạo tài khoản tại <https://github.com> (nếu chưa có).
2. Tạo repository mới (ví dụ tên `quanlykho`), để **Private** cũng được.
3. Trong thư mục dự án, chạy (PowerShell):
   ```powershell
   $env:Path = "C:\Program Files\nodejs;" + $env:Path
   git init
   git add .
   git commit -m "Quan ly kho"
   git branch -M main
   git remote add origin https://github.com/<TEN_CUA_BAN>/quanlykho.git
   git push -u origin main
   ```
   > File `.env` và `db/kho.db` sẽ KHÔNG bị đẩy lên (đã có trong `.gitignore`) — an toàn.

---

## Bước 2 — Tạo database Turso (miễn phí)

1. Vào <https://turso.tech> → **Sign up** bằng GitHub.
2. Tạo một **Database** mới (chọn region gần VN, ví dụ Singapore).
3. Lấy 2 thông tin (trong phần *Connect* / *Settings* của database):
   - **Database URL**: dạng `libsql://ten-db-xxxx.turso.io`
   - **Auth Token**: bấm *Create Token* để lấy chuỗi token dài.
   > Giữ kỹ 2 giá trị này, sẽ dán vào Vercel ở bước sau.

*(Nếu Turso yêu cầu cài CLI: cài rồi chạy `turso db create quanlykho`, `turso db show quanlykho --url`, `turso db tokens create quanlykho`.)*

---

## Bước 3 — Tạo dự án trên Vercel

1. Vào <https://vercel.com> → **Sign up** bằng GitHub.
2. **Add New… → Project** → chọn repo `quanlykho` vừa đẩy lên → **Import**.
3. Phần **Environment Variables**, thêm các biến sau (Add lần lượt):

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | URL libsql:// từ Turso |
   | `TURSO_AUTH_TOKEN` | token từ Turso |
   | `SESSION_SECRET` | một chuỗi ngẫu nhiên thật dài (tự gõ lung tung) |
   | `NODE_ENV` | `production` |
   | `APP_NAME` | `Quản Lý Kho` |
   | `BASE_URL` | `https://quanlykhohang.vercel.app` (sửa đúng tên app của bạn) |

4. Bấm **Deploy** và đợi build xong.

---

## Bước 4 — Dùng thử

1. Mở `https://<ten-app>.vercel.app`.
2. **Đăng ký** tài khoản đầu tiên → đây sẽ là **Admin**.
3. Thiết lập **2FA** (quét QR bằng Google Authenticator) → đăng nhập.
4. Bắt đầu quản lý kho. Dữ liệu giờ lưu trên Turso (vĩnh viễn, không mất).

> Sau khi biết URL chính xác, nếu lúc đầu bạn đặt `BASE_URL` chưa đúng:
> vào Vercel → Project → Settings → Environment Variables → sửa `BASE_URL` → **Redeploy**.

---

## Gắn tên miền riêng `quanlykho.com` (tùy chọn, cần mua tên miền)

1. Mua tên miền `quanlykho.com` ở Namecheap / GoDaddy / Mắt Bão (~250–350k/năm, nếu còn trống).
2. Vercel → Project → **Settings → Domains** → Add `quanlykho.com`.
3. Vercel hiện các bản ghi DNS (A/CNAME) cần thêm → vào trang quản lý tên miền điền theo.
4. Đợi DNS cập nhật (vài phút–vài giờ). Nhớ sửa `BASE_URL` thành `https://quanlykho.com` rồi Redeploy.

---

## Cập nhật web sau này

Mỗi khi sửa code, chỉ cần:
```powershell
git add .
git commit -m "Cap nhat"
git push
```
Vercel sẽ **tự build & deploy lại**.

## Câu hỏi thường gặp

- **Chạy local còn được không?** Còn. Cứ `start.bat` như cũ — không có biến Turso thì tự dùng file `db/kho.db`.
- **Mất dữ liệu khi deploy lại không?** Không. Dữ liệu nằm ở Turso, tách khỏi code.
- **Dữ liệu local có tự lên Turso không?** Không. Local và Turso là 2 kho riêng. Trên web mới bạn đăng ký/nhập lại (hoặc dùng Xuất CSV ở local rồi Nhập hàng loạt trên web).
