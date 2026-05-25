# ShieldCare — Bảo hiểm xe mô tô & ô tô

Website tư vấn bảo hiểm (frontend tĩnh) + quản trị admin (Express + SQLite).

## Cấu trúc

| Thành phần | File chính | Deploy |
|------------|------------|--------|
| Trang khách | `index.html`, `frontend.js`, `style.css` | **Vercel** |
| Trang admin | `admin.html`, `admin.js` | Vercel hoặc cùng Render |
| API + DB | `script.js`, `database.js` | **Render** |

## Chạy local

```bash
npm install
npm start
```

- Trang chủ: http://localhost:3000/
- Admin: http://localhost:3000/admin.html  
- Đăng nhập mặc định: `baohiem@mo` / `123456` (đổi trong `.env`)

## Deploy production

### 1. Backend (Render)

1. Tạo **Web Service**, connect repo GitHub.
2. **Build:** `npm install`
3. **Start:** `npm start`
4. Biến môi trường:
   - `NODE_ENV=production`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (chuỗi bí mật dài)
   - `CORS_ALLOWED_ORIGINS=https://your-app.vercel.app` (domain Vercel của bạn)
5. Ghi lại URL Render, ví dụ `https://web-bao-hiem.onrender.com`

### 2. Frontend (Vercel)

1. Import repo, **Root Directory** = thư mục project.
2. Framework: Other (static).
3. Sửa URL API trong **hai chỗ** (thay domain Render thật):
   - `index.html` → `<meta name="api-base" content="https://...onrender.com" />`
   - `admin.html` → cùng meta `api-base`
   - Hoặc sửa `RENDER_API_ORIGIN` trong `api-config.js`
4. Deploy — không cần rewrite API (frontend gọi thẳng Render).

### 3. Kiểm tra sau deploy

- `GET https://<render>/api/health` → `{ "ok": true }`
- Trang Vercel: gửi form **Gửi yêu cầu** → admin thấy trong **Yêu cầu website**
- `admin.html` trên Vercel: đăng nhập / đăng xuất / đổi tab không treo

## Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|-------------|------------|
| Port 3000 **EADDRINUSE** | `netstat -ano \| findstr :3000` rồi `taskkill /PID <pid> /F` |
| Trang chủ trắng | Đảm bảo `index.html` có nội dung và đã deploy lên Vercel |
| API 404 trên Vercel | Sửa `api-base` / `api-config.js` trỏ đúng Render |
| Đăng nhập admin fail (Vercel) | `NODE_ENV=production` trên Render + `CORS_ALLOWED_ORIGINS` |

## Công nghệ

HTML/CSS/JS thuần, Express, SQLite, session cookie (admin).
