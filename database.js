/**
 * database.js — Kết nối SQLite (một kết nối duy nhất, hàng đợi thao tác)
 */
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "database.db");

let dbReady = false;
let dbQueue = Promise.resolve();

/** Mở kết nối database (dùng chung cho toàn app) */
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Không mở được database:", err.message);
  } else {
    console.log("Đã kết nối SQLite:", DB_PATH);
  }
});

/** Xếp hàng thao tác DB — tránh SQLITE_BUSY khi nhiều API chạy song song */
function enqueue(task) {
  const run = dbQueue.then(() => task());
  dbQueue = run.catch(() => {});
  return run;
}

function run(sql, params = []) {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        });
      })
  );
}

function get(sql, params = []) {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      })
  );
}

function all(sql, params = []) {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      })
  );
}

/** Cấu hình SQLite — giảm treo do khóa file (Windows / Render) */
async function configurePragmas() {
  await run("PRAGMA foreign_keys = ON");
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA busy_timeout = 10000");
  await run("PRAGMA synchronous = NORMAL");
}

async function initDatabase() {
  if (dbReady) return;
  await configurePragmas();
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenKhachHang TEXT NOT NULL,
      bienSo TEXT UNIQUE NOT NULL,
      ngayHieuLuc TEXT NOT NULL,
      ngayHetHan TEXT NOT NULL,
      soDienThoai TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS customer_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenKhachHang TEXT NOT NULL,
      soDienThoai TEXT NOT NULL,
      bienSo TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Yêu cầu mới'
    )
  `);
  dbReady = true;
  console.log("Bảng customers (bảo hiểm) và customer_requests (yêu cầu web) đã sẵn sàng.");
}

/** Đóng kết nối khi tắt server — tránh Database locked / EADDRINUSE khi khởi động lại */
function closeDatabase() {
  return new Promise((resolve) => {
    if (!db) return resolve();
    db.close((err) => {
      if (err) console.error("Lỗi đóng database:", err.message);
      else console.log("Đã đóng kết nối SQLite.");
      resolve();
    });
  });
}

function formatCreatedAt() {
  return new Date().toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sanitizeText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function parseDateOnly(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getTrangThai(ngayHetHan) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hetHan = parseDateOnly(ngayHetHan);
  if (!hetHan) {
    return { code: "het_han", label: "Đã hết hạn" };
  }

  const diffMs = hetHan.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { code: "het_han", label: "Đã hết hạn" };
  }
  if (diffDays <= 7) {
    return { code: "sap_het_han", label: "Sắp hết hạn" };
  }
  return { code: "con_hieu_luc", label: "Còn hiệu lực" };
}

function attachTrangThai(customers) {
  return customers.map((c) => ({
    ...c,
    trangThai: getTrangThai(c.ngayHetHan),
  }));
}

function filterByTrangThai(customers, filterCode) {
  if (!filterCode || filterCode === "all") return customers;
  return customers.filter((c) => c.trangThai.code === filterCode);
}

function filterBySearch(customers, search) {
  const q = (search || "").trim().toLowerCase();
  if (!q) return customers;
  return customers.filter(
    (c) =>
      c.tenKhachHang.toLowerCase().includes(q) ||
      c.bienSo.toLowerCase().includes(q)
  );
}

async function getAllCustomers() {
  return all(
    "SELECT id, tenKhachHang, bienSo, ngayHieuLuc, ngayHetHan, soDienThoai, createdAt FROM customers ORDER BY id DESC"
  );
}

async function getCustomerById(id) {
  return get(
    "SELECT id, tenKhachHang, bienSo, ngayHieuLuc, ngayHetHan, soDienThoai, createdAt FROM customers WHERE id = ?",
    [id]
  );
}

async function getCustomerByBienSo(bienSo, excludeId = null) {
  if (excludeId) {
    return get("SELECT id FROM customers WHERE bienSo = ? AND id != ?", [
      bienSo,
      excludeId,
    ]);
  }
  return get("SELECT id FROM customers WHERE bienSo = ?", [bienSo]);
}

async function createCustomer(data) {
  const createdAt = new Date().toISOString();
  const result = await run(
    `INSERT INTO customers (tenKhachHang, bienSo, ngayHieuLuc, ngayHetHan, soDienThoai, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.tenKhachHang,
      data.bienSo,
      data.ngayHieuLuc,
      data.ngayHetHan,
      data.soDienThoai,
      createdAt,
    ]
  );
  return getCustomerById(result.id);
}

async function updateCustomer(id, data) {
  await run(
    `UPDATE customers SET tenKhachHang = ?, bienSo = ?, ngayHieuLuc = ?, ngayHetHan = ?, soDienThoai = ?
     WHERE id = ?`,
    [
      data.tenKhachHang,
      data.bienSo,
      data.ngayHieuLuc,
      data.ngayHetHan,
      data.soDienThoai,
      id,
    ]
  );
  return getCustomerById(id);
}

async function deleteCustomer(id) {
  const result = await run("DELETE FROM customers WHERE id = ?", [id]);
  return result.changes > 0;
}

async function createCustomerRequest(data) {
  const createdAt = formatCreatedAt();
  const status = "Yêu cầu mới";
  const result = await run(
    `INSERT INTO customer_requests (tenKhachHang, soDienThoai, bienSo, createdAt, status)
     VALUES (?, ?, ?, ?, ?)`,
    [data.tenKhachHang, data.soDienThoai, data.bienSo, createdAt, status]
  );
  return getCustomerRequestById(result.id);
}

async function getCustomerRequestById(id) {
  return get(
    "SELECT id, tenKhachHang, soDienThoai, bienSo, createdAt, status FROM customer_requests WHERE id = ?",
    [id]
  );
}

async function getAllCustomerRequests() {
  return all(
    "SELECT id, tenKhachHang, soDienThoai, bienSo, createdAt, status FROM customer_requests ORDER BY id DESC"
  );
}

async function deleteCustomerRequest(id) {
  const result = await run("DELETE FROM customer_requests WHERE id = ?", [id]);
  return result.changes > 0;
}

function filterRequestsByStatus(requests, statusFilter) {
  if (!statusFilter || statusFilter === "all") return requests;
  return requests.filter((r) => r.status === statusFilter);
}

function filterRequestsBySearch(requests, search) {
  const q = (search || "").trim().toLowerCase();
  if (!q) return requests;
  return requests.filter(
    (r) =>
      r.tenKhachHang.toLowerCase().includes(q) ||
      r.bienSo.toLowerCase().includes(q) ||
      r.soDienThoai.includes(q)
  );
}

module.exports = {
  initDatabase,
  closeDatabase,
  getTrangThai,
  attachTrangThai,
  filterByTrangThai,
  filterBySearch,
  getAllCustomers,
  getCustomerById,
  getCustomerByBienSo,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  parseDateOnly,
  formatCreatedAt,
  sanitizeText,
  createCustomerRequest,
  getCustomerRequestById,
  getAllCustomerRequests,
  deleteCustomerRequest,
  filterRequestsByStatus,
  filterRequestsBySearch,
};
