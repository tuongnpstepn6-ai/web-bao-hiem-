/**
 * validators.js — Kiểm tra dữ liệu khách hàng (dùng chung logic backend)
 */

const PHONE_REGEX = /^(0|\+84)[0-9]{8,10}$/;

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Chuẩn hóa biển số: viết hoa, bỏ khoảng thừa */
function normalizeBienSo(bienSo) {
  return trimStr(bienSo).toUpperCase().replace(/\s+/g, "");
}

function validateCustomerBody(body, parseDateOnly) {
  const errors = [];

  const tenKhachHang = trimStr(body.tenKhachHang);
  const bienSo = normalizeBienSo(body.bienSo);
  const ngayHieuLuc = trimStr(body.ngayHieuLuc);
  const ngayHetHan = trimStr(body.ngayHetHan);
  const soDienThoai = trimStr(body.soDienThoai).replace(/\s/g, "");

  if (!tenKhachHang) errors.push("Tên khách hàng không được để trống.");
  if (!bienSo) errors.push("Biển số không được để trống.");
  if (!ngayHieuLuc) errors.push("Ngày hiệu lực không được để trống.");
  if (!ngayHetHan) errors.push("Ngày hết hạn không được để trống.");
  if (!soDienThoai) errors.push("Số điện thoại không được để trống.");

  if (soDienThoai && !PHONE_REGEX.test(soDienThoai)) {
    errors.push("Số điện thoại không hợp lệ (ví dụ: 0901234567).");
  }

  const dHieuLuc = parseDateOnly(ngayHieuLuc);
  const dHetHan = parseDateOnly(ngayHetHan);

  if (ngayHieuLuc && !dHieuLuc) errors.push("Ngày hiệu lực không đúng định dạng.");
  if (ngayHetHan && !dHetHan) errors.push("Ngày hết hạn không đúng định dạng.");

  if (dHieuLuc && dHetHan && dHetHan.getTime() <= dHieuLuc.getTime()) {
    errors.push("Ngày hết hạn phải lớn hơn ngày hiệu lực.");
  }

  return {
    ok: errors.length === 0,
    errors,
    data: { tenKhachHang, bienSo, ngayHieuLuc, ngayHetHan, soDienThoai },
  };
}

/** Validate yêu cầu từ khách (form trang chủ) */
function validateCustomerRequest(body, sanitizeText) {
  const errors = [];
  const tenKhachHang = sanitizeText(body.tenKhachHang, 120);
  const soDienThoai = sanitizeText(body.soDienThoai, 20).replace(/\s/g, "");
  const bienSo = sanitizeText(body.bienSo, 30);

  if (!tenKhachHang) errors.push("Tên khách hàng không được để trống.");
  if (!soDienThoai) errors.push("Số điện thoại không được để trống.");
  else if (!PHONE_REGEX.test(soDienThoai)) {
    errors.push("Số điện thoại không hợp lệ.");
  }
  if (!bienSo) errors.push("Biển số không được để trống.");

  return {
    ok: errors.length === 0,
    errors,
    data: { tenKhachHang, soDienThoai, bienSo },
  };
}

module.exports = {
  validateCustomerBody,
  validateCustomerRequest,
  normalizeBienSo,
  PHONE_REGEX,
};
