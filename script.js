/**
 * script.js — Backend Express (Render / local)
 * - API trước, file tĩnh sau (tránh static “nuốt” /login, /logout)
 * - Session destroy an toàn + đóng SQLite khi tắt process
 */
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const db = require("./database");
const { validateCustomerBody, validateCustomerRequest } = require("./validators");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}
const SESSION_COOKIE_NAME = "connect.sid";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "baohiem@mo";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "shieldcare-bao-hiem-mo-to-session-2026";

const VERCEL_ORIGIN_PATTERN = /^https:\/\/[\w.-]+\.vercel\.app$/;

let httpServer = null;
let isShuttingDown = false;

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (process.env.CORS_ALLOW_ALL === "true") return true;
  if (VERCEL_ORIGIN_PATTERN.test(origin)) return true;
  const extra = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function getSessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    secure: IS_PRODUCTION,
  };
}

/** Bọc async route — luôn trả JSON lỗi, không treo request */
function wrapAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error("[API]", req.method, req.path, err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Lỗi máy chủ nội bộ." });
      }
    });
  };
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
}

/** Đăng xuất — luôn gửi phản hồi JSON (không callback lặp / treo) */
function handleLogout(req, res) {
  if (res.headersSent) return;

  const finish = (err) => {
    if (res.headersSent) return;
    clearSessionCookie(res);
    if (err) {
      return res.status(500).json({ success: false, error: "Không thể đăng xuất." });
    }
    return res.json({ success: true, message: "Đã đăng xuất." });
  };

  if (!req.session) {
    return finish(null);
  }

  req.session.destroy((err) => {
    req.session = null;
    finish(err);
  });
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: "1mb" }));

app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      ...getSessionCookieOptions(),
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ success: false, error: "Chưa đăng nhập hoặc phiên hết hạn." });
}

// ---------- API (đặt TRƯỚC express.static) ----------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "shieldcare-api" });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin) });
});

app.post("/login", (req, res) => {
  const adminUser =
    typeof req.body.admin === "string"
      ? req.body.admin.trim()
      : typeof req.body.email === "string"
        ? req.body.email.trim()
        : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!adminUser || !password) {
    return res.status(400).json({ success: false, error: "Vui lòng nhập Admin và mật khẩu." });
  }

  if (adminUser === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true, message: "Đăng nhập thành công." });
  }

  return res.status(401).json({ success: false, error: "Admin hoặc mật khẩu không đúng." });
});

app.get("/logout", handleLogout);
app.post("/logout", handleLogout);

app.get(
  "/customers",
  requireAuth,
  wrapAsync(async (req, res) => {
    const filter = req.query.filter || "all";
    const search = req.query.search || "";

    let list = await db.getAllCustomers();
    list = db.attachTrangThai(list);
    list = db.filterByTrangThai(list, filter);
    list = db.filterBySearch(list, search);

    res.json({ success: true, data: list });
  })
);

app.post(
  "/customers",
  requireAuth,
  wrapAsync(async (req, res) => {
    const { ok, errors, data } = validateCustomerBody(req.body, db.parseDateOnly);
    if (!ok) {
      return res.status(400).json({ success: false, errors });
    }

    const existed = await db.getCustomerByBienSo(data.bienSo);
    if (existed) {
      return res.status(400).json({ success: false, error: "Biển số đã tồn tại." });
    }

    const created = await db.createCustomer(data);
    res.status(201).json({
      success: true,
      data: { ...created, trangThai: db.getTrangThai(created.ngayHetHan) },
    });
  })
);

app.put(
  "/customers/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: "ID không hợp lệ." });
    }

    const current = await db.getCustomerById(id);
    if (!current) {
      return res.status(404).json({ success: false, error: "Không tìm thấy khách hàng." });
    }

    const { ok, errors, data } = validateCustomerBody(req.body, db.parseDateOnly);
    if (!ok) {
      return res.status(400).json({ success: false, errors });
    }

    const existed = await db.getCustomerByBienSo(data.bienSo, id);
    if (existed) {
      return res.status(400).json({ success: false, error: "Biển số đã tồn tại." });
    }

    const updated = await db.updateCustomer(id, data);
    res.json({
      success: true,
      data: { ...updated, trangThai: db.getTrangThai(updated.ngayHetHan) },
    });
  })
);

app.delete(
  "/customers/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: "ID không hợp lệ." });
    }

    const deleted = await db.deleteCustomer(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Không tìm thấy khách hàng." });
    }

    res.json({ success: true, message: "Đã xóa khách hàng." });
  })
);

app.post(
  "/customer-request",
  wrapAsync(async (req, res) => {
    const { ok, errors, data } = validateCustomerRequest(req.body, db.sanitizeText);
    if (!ok) {
      return res.status(400).json({ success: false, errors });
    }

    const created = await db.createCustomerRequest(data);
    console.log("[customer-request]", created);
    res.status(201).json({ success: true, data: created });
  })
);

app.get(
  "/customer-requests",
  requireAuth,
  wrapAsync(async (req, res) => {
    const statusFilter = req.query.status || "all";
    const search = req.query.search || "";

    let list = await db.getAllCustomerRequests();
    list = db.filterRequestsByStatus(list, statusFilter);
    list = db.filterRequestsBySearch(list, search);

    res.json({ success: true, data: list });
  })
);

app.delete(
  "/customer-requests/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: "ID không hợp lệ." });
    }
    const deleted = await db.deleteCustomerRequest(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Không tìm thấy yêu cầu." });
    }
    res.json({ success: true, message: "Đã xóa yêu cầu." });
  })
);

// File tĩnh — sau API để /logout không bị static chặn
app.use(express.static(path.join(__dirname)));

app.use((req, res) => {
  if (req.path.startsWith("/api") || req.accepts("json") === "json") {
    return res.status(404).json({ success: false, error: "Không tìm thấy API." });
  }
  res.status(404).send("Không tìm thấy trang.");
});

app.use((err, req, res, _next) => {
  console.error("[Express]", err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: "Lỗi máy chủ." });
  }
});

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Đang tắt server (${signal})...`);

  const forceExit = setTimeout(() => {
    console.error("Tắt server quá lâu — thoát process.");
    process.exit(1);
  }, 8000);

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    await db.closeDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error("Lỗi khi tắt:", err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function startServer() {
  try {
    await db.initDatabase();

    httpServer = app.listen(PORT, () => {
      console.log(`Server chạy tại http://localhost:${PORT}`);
      console.log(`Trang admin: http://localhost:${PORT}/admin.html`);
    });

    httpServer.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} đang bị chiếm. Dừng process cũ (Task Manager / netstat) rồi chạy lại npm start.`
        );
      } else {
        console.error("Lỗi HTTP server:", err);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error("Không khởi động được server:", err);
    process.exit(1);
  }
}

startServer();
