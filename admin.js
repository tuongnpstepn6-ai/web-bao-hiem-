/**
 * admin.js — Hai hệ thống riêng:
 * A) customers — khách hàng bảo hiểm đang quản lý
 * B) customer_requests — yêu cầu từ website
 */
(function () {
  "use strict";

  const API_BASE =
    typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "";
  const STATUS_NEW = "Yêu cầu mới";
  const PHONE_REGEX = /^(0|\+84)[0-9]{8,11}$/;

  let currentView = "dashboard";
  let customersFilter = "all";
  let requestsStatusFilter = "all";
  let customersCache = [];
  let requestsCache = [];
  let editingCustomerId = null;
  let searchCustomersTimer = null;
  let searchRequestsTimer = null;
  /** Chỉ hủy khi logout — không hủy request song song (tránh nhảy về login) */
  let pendingControllers = [];
  const API_TIMEOUT_MS = 20000;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showLoading(show) {
    const el = document.getElementById("admin-loading");
    if (el) el.hidden = !show;
  }

  function showToast(message, type) {
    const toast = document.getElementById("admin-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "admin-toast admin-toast--" + (type === "error" ? "error" : "success");
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.hidden = true;
    }, 3500);
  }

  function cancelPendingApiCalls() {
    clearTimeout(searchCustomersTimer);
    clearTimeout(searchRequestsTimer);
    searchCustomersTimer = null;
    searchRequestsTimer = null;
    pendingControllers.forEach(function (c) {
      c.abort();
    });
    pendingControllers = [];
  }

  function removeController(controller) {
    pendingControllers = pendingControllers.filter(function (c) {
      return c !== controller;
    });
  }

  async function apiFetch(url, options) {
    const opts = Object.assign({}, options || {});
    const controller = new AbortController();
    pendingControllers.push(controller);
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, API_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(API_BASE + url, {
        method: opts.method || "GET",
        credentials: "include",
        headers: Object.assign(
          { "Content-Type": "application/json", Accept: "application/json" },
          opts.headers || {}
        ),
        body: opts.body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        return {
          res: { ok: false, status: 0 },
          data: { error: "Yêu cầu quá thời gian hoặc đã hủy." },
        };
      }
      return {
        res: { ok: false, status: 0 },
        data: { error: "Không kết nối được máy chủ." },
      };
    } finally {
      clearTimeout(timeoutId);
      removeController(controller);
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { res, data };
  }

  function showLoginOnly() {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("dashboard-screen").hidden = true;
  }

  function showApp() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("dashboard-screen").hidden = false;
  }

  async function checkAuth() {
    const { res, data } = await apiFetch("/api/auth/status");
    return res.ok && data.loggedIn === true;
  }

  /** Chuyển tab menu — không gọi API nếu chưa đăng nhập */
  function switchView(view) {
    if (document.getElementById("dashboard-screen").hidden) {
      return;
    }
    currentView = view;
    document.querySelectorAll(".admin-nav__item[data-view]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
    });
    document.querySelectorAll(".admin-panel").forEach(function (panel) {
      const isActive = panel.getAttribute("data-panel") === view;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });

    if (view === "dashboard") refreshDashboard();
    if (view === "customers") loadCustomers();
    if (view === "requests") loadRequests();
    if (view === "expiring") loadExpiring();
  }

  function statusBadgeHtml(code, label) {
    return (
      '<span class="status-badge status-badge--' +
      escapeHtml(code) +
      '">' +
      escapeHtml(label) +
      "</span>"
    );
  }

  // ---------- Dashboard ----------
  async function refreshDashboard() {
    const [custRes, reqRes] = await Promise.all([
      apiFetch("/customers?filter=all"),
      apiFetch("/customer-requests?status=all"),
    ]);

    if (custRes.res.status === 401 || reqRes.res.status === 401) {
      showLoginOnly();
      return;
    }

    const customers = custRes.data.success ? custRes.data.data || [] : [];
    const requests = reqRes.data.success ? reqRes.data.data || [] : [];

    const expiring = customers.filter(function (c) {
      return c.trangThai && c.trangThai.code === "sap_het_han";
    }).length;
    const expired = customers.filter(function (c) {
      return c.trangThai && c.trangThai.code === "het_han";
    }).length;
    const newReq = requests.filter(function (r) {
      return r.status === STATUS_NEW;
    }).length;

    document.getElementById("dash-customers-total").textContent = String(customers.length);
    document.getElementById("dash-expiring").textContent = String(expiring);
    document.getElementById("dash-expired").textContent = String(expired);
    document.getElementById("dash-requests-new").textContent = String(newReq);

    updateBadges(expiring, newReq);
  }

  function updateBadges(expiringCount, newRequestsCount) {
    const bReq = document.getElementById("badge-requests");
    const bExp = document.getElementById("badge-expiring");
    if (bReq) {
      bReq.textContent = String(newRequestsCount);
      bReq.hidden = newRequestsCount <= 0;
    }
    if (bExp) {
      bExp.textContent = String(expiringCount);
      bExp.hidden = expiringCount <= 0;
    }
  }

  // ---------- A. Customers (bảng customers) ----------
  function renderCustomersTable(list, tbodyId, showEdit) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="admin-table__empty">Không có dữ liệu</td></tr>';
      return;
    }

    const colCount = tbodyId === "expiring-tbody" ? 6 : 7;
    tbody.innerHTML = list
      .map(function (c) {
        const st = c.trangThai || { code: "", label: "" };
        const warnRow = st.code === "sap_het_han" ? " admin-row--new" : "";
        const editBtn = showEdit
          ? '<button type="button" class="btn-icon btn-edit-customer" data-id="' +
            c.id +
            '"><i class="fa-solid fa-pen"></i></button>' +
            '<button type="button" class="btn-icon btn-icon--danger btn-delete-customer" data-id="' +
            c.id +
            '"><i class="fa-solid fa-trash"></i></button>'
          : '<button type="button" class="btn-icon btn-edit-customer" data-id="' +
            c.id +
            '" title="Sửa"><i class="fa-solid fa-pen"></i></button>';

        if (tbodyId === "expiring-tbody") {
          return (
            "<tr class=\"" +
            warnRow +
            "\">" +
            "<td>" +
            escapeHtml(c.tenKhachHang) +
            "</td>" +
            "<td><strong>" +
            escapeHtml(c.bienSo) +
            "</strong></td>" +
            "<td>" +
            escapeHtml(c.ngayHetHan) +
            "</td>" +
            "<td>" +
            escapeHtml(c.soDienThoai) +
            "</td>" +
            "<td>" +
            statusBadgeHtml(st.code, st.label) +
            "</td>" +
            '<td class="admin-table__actions">' +
            editBtn +
            "</td></tr>"
          );
        }

        return (
          "<tr class=\"" +
          warnRow +
          "\">" +
          "<td>" +
          escapeHtml(c.tenKhachHang) +
          "</td>" +
          "<td><strong>" +
          escapeHtml(c.bienSo) +
          "</strong></td>" +
          "<td>" +
          escapeHtml(c.ngayHieuLuc) +
          "</td>" +
          "<td>" +
          escapeHtml(c.ngayHetHan) +
          "</td>" +
          "<td>" +
          escapeHtml(c.soDienThoai) +
          "</td>" +
          "<td>" +
          statusBadgeHtml(st.code, st.label) +
          "</td>" +
          '<td class="admin-table__actions">' +
          editBtn +
          "</td></tr>"
        );
      })
      .join("");

    if (colCount === 6 && list.length && tbody.querySelector("tr td")) {
      /* ok */
    }

    tbody.querySelectorAll(".btn-edit-customer").forEach(function (btn) {
      btn.addEventListener("click", function () {
        startEditCustomer(Number(btn.getAttribute("data-id")));
        switchView("customers");
      });
    });

    tbody.querySelectorAll(".btn-delete-customer").forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteCustomer(Number(btn.getAttribute("data-id")));
      });
    });
  }

  async function loadCustomers() {
    const search = document.getElementById("customers-search").value.trim();
    const qs =
      "?filter=" + encodeURIComponent(customersFilter) + "&search=" + encodeURIComponent(search);
    const { res, data } = await apiFetch("/customers" + qs);

    if (res.status === 401) {
      showLoginOnly();
      return;
    }
    if (!res.ok || !data.success) {
      showToast(data.error || "Lỗi tải khách hàng.", "error");
      return;
    }

    customersCache = data.data || [];
    renderCustomersTable(customersCache, "customers-tbody", true);
  }

  async function loadExpiring() {
    const { res, data } = await apiFetch("/customers?filter=sap_het_han");

    if (res.status === 401) {
      showLoginOnly();
      return;
    }
    if (!res.ok || !data.success) {
      showToast(data.error || "Lỗi tải danh sách.", "error");
      return;
    }

    renderCustomersTable(data.data || [], "expiring-tbody", false);
  }

  function resetCustomerForm() {
    editingCustomerId = null;
    document.getElementById("customer-form").reset();
    document.getElementById("customer-id").value = "";
    document.getElementById("customer-form-title").textContent = "Thêm khách hàng";
    document.getElementById("customer-submit").textContent = "Lưu";
    document.getElementById("customer-cancel").hidden = true;
    ["c-tenKhachHang", "c-bienSo", "c-ngayHieuLuc", "c-ngayHetHan", "c-soDienThoai"].forEach(
      function (id) {
        const input = document.getElementById(id);
        const err = document.getElementById("error-" + id);
        if (input) input.classList.remove("is-invalid");
        if (err) err.textContent = "";
      }
    );
  }

  function validateCustomerForm() {
    let valid = true;
    const fields = [
      { id: "c-tenKhachHang", msg: "Nhập tên khách hàng." },
      { id: "c-bienSo", msg: "Nhập biển số." },
      { id: "c-ngayHieuLuc", msg: "Chọn ngày hiệu lực." },
      { id: "c-ngayHetHan", msg: "Chọn ngày hết hạn." },
      { id: "c-soDienThoai", msg: "Nhập số điện thoại." },
    ];

    fields.forEach(function (f) {
      const input = document.getElementById(f.id);
      const err = document.getElementById("error-" + f.id);
      input.classList.remove("is-invalid");
      if (err) err.textContent = "";
    });

    const ten = document.getElementById("c-tenKhachHang").value.trim();
    const bien = document.getElementById("c-bienSo").value.trim().toUpperCase();
    const hieuLuc = document.getElementById("c-ngayHieuLuc").value;
    const hetHan = document.getElementById("c-ngayHetHan").value;
    const sdt = document.getElementById("c-soDienThoai").value.trim().replace(/\s/g, "");

    function err(id, msg) {
      valid = false;
      document.getElementById(id).classList.add("is-invalid");
      document.getElementById("error-" + id).textContent = msg;
    }

    if (!ten) err("c-tenKhachHang", "Nhập tên khách hàng.");
    if (!bien) err("c-bienSo", "Nhập biển số.");
    if (!hieuLuc) err("c-ngayHieuLuc", "Chọn ngày hiệu lực.");
    if (!hetHan) err("c-ngayHetHan", "Chọn ngày hết hạn.");
    if (!sdt) err("c-soDienThoai", "Nhập số điện thoại.");
    else if (!PHONE_REGEX.test(sdt)) err("c-soDienThoai", "SĐT không hợp lệ.");

    if (hieuLuc && hetHan && hetHan <= hieuLuc) {
      err("c-ngayHetHan", "Ngày hết hạn phải sau ngày hiệu lực.");
    }

    if (!valid) return null;
    return {
      tenKhachHang: ten,
      bienSo: bien,
      ngayHieuLuc: hieuLuc,
      ngayHetHan: hetHan,
      soDienThoai: sdt,
    };
  }

  function startEditCustomer(id) {
    const c = customersCache.find(function (x) {
      return x.id === id;
    });
    if (!c) return;
    editingCustomerId = id;
    document.getElementById("c-tenKhachHang").value = c.tenKhachHang;
    document.getElementById("c-bienSo").value = c.bienSo;
    document.getElementById("c-ngayHieuLuc").value = c.ngayHieuLuc;
    document.getElementById("c-ngayHetHan").value = c.ngayHetHan;
    document.getElementById("c-soDienThoai").value = c.soDienThoai;
    document.getElementById("customer-form-title").textContent = "Sửa khách hàng";
    document.getElementById("customer-submit").textContent = "Cập nhật";
    document.getElementById("customer-cancel").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteCustomer(id) {
    const c = customersCache.find(function (x) {
      return x.id === id;
    });
    if (!c || !confirm("Xóa khách \"" + c.tenKhachHang + "\" khỏi hệ thống bảo hiểm?")) return;

    showLoading(true);
    const { res, data } = await apiFetch("/customers/" + id, { method: "DELETE" });
    showLoading(false);

    if (!res.ok) {
      showToast(data.error || "Xóa thất bại.", "error");
      return;
    }
    showToast("Đã xóa khách hàng bảo hiểm.", "success");
    if (editingCustomerId === id) resetCustomerForm();
    await loadCustomers();
    await refreshDashboard();
    if (currentView === "expiring") await loadExpiring();
  }

  // ---------- B. Customer requests ----------
  function renderRequestsTable(list) {
    const tbody = document.getElementById("requests-tbody");
    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="admin-table__empty">Không có yêu cầu</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map(function (r) {
        const isNew = r.status === STATUS_NEW;
        const rowClass = isNew ? "admin-row--new" : "";
        const badge = isNew ? "status-badge--new" : "status-badge--default";
        return (
          '<tr class="' +
          rowClass +
          '">' +
          "<td>" +
          escapeHtml(r.tenKhachHang) +
          "</td>" +
          "<td>" +
          escapeHtml(r.soDienThoai) +
          "</td>" +
          "<td><strong>" +
          escapeHtml(r.bienSo) +
          "</strong></td>" +
          "<td>" +
          escapeHtml(r.createdAt) +
          "</td>" +
          '<td><span class="status-badge ' +
          badge +
          '">' +
          escapeHtml(r.status) +
          "</span></td>" +
          '<td class="admin-table__actions">' +
          '<button type="button" class="btn-icon btn-icon--danger btn-delete-request" data-id="' +
          r.id +
          '"><i class="fa-solid fa-trash"></i></button>' +
          "</td></tr>"
        );
      })
      .join("");

    tbody.querySelectorAll(".btn-delete-request").forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteRequest(Number(btn.getAttribute("data-id")));
      });
    });
  }

  async function loadRequests() {
    const search = document.getElementById("requests-search").value.trim();
    const qs =
      "?status=" +
      encodeURIComponent(requestsStatusFilter) +
      "&search=" +
      encodeURIComponent(search);
    const { res, data } = await apiFetch("/customer-requests" + qs);

    if (res.status === 401) {
      showLoginOnly();
      return;
    }
    if (!res.ok || !data.success) {
      showToast(data.error || "Lỗi tải yêu cầu.", "error");
      return;
    }

    requestsCache = data.data || [];
    renderRequestsTable(requestsCache);
  }

  async function deleteRequest(id) {
    const r = requestsCache.find(function (x) {
      return x.id === id;
    });
    if (!r || !confirm("Xóa yêu cầu của \"" + r.tenKhachHang + "\"?")) return;

    showLoading(true);
    const { res, data } = await apiFetch("/customer-requests/" + id, { method: "DELETE" });
    showLoading(false);

    if (!res.ok) {
      showToast(data.error || "Xóa thất bại.", "error");
      return;
    }
    showToast("Đã xóa yêu cầu website.", "success");
    await loadRequests();
    await refreshDashboard();
  }

  // ---------- Sự kiện ----------
  function bindEvents() {
    document.getElementById("login-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const admin = document.getElementById("login-admin").value.trim();
      const password = document.getElementById("login-password").value;
      if (!admin || !password) {
        showToast("Nhập Admin và mật khẩu.", "error");
        return;
      }
      showLoading(true);
      const { res, data } = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify({ admin: admin, password: password }),
      });
      showLoading(false);
      if (!res.ok) {
        showToast(data.error || "Đăng nhập thất bại.", "error");
        return;
      }
      showToast("Đăng nhập thành công!", "success");
      showApp();
      switchView("dashboard");
    });

    document.getElementById("btn-logout").addEventListener("click", async function () {
      cancelPendingApiCalls();
      showLoading(true);
      try {
        const { res } = await apiFetch("/logout", { method: "POST" });
        if (!res.ok && res.status !== 0) {
          showToast("Đăng xuất có thể chưa hoàn tất trên server.", "error");
        }
      } finally {
        showLoading(false);
        showLoginOnly();
        showToast("Đã đăng xuất.", "success");
      }
    });

    document.querySelectorAll(".admin-nav__item[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchView(btn.getAttribute("data-view"));
      });
    });

    document.querySelectorAll("[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchView(btn.getAttribute("data-goto"));
      });
    });

    document.getElementById("sidebar-toggle").addEventListener("click", function () {
      document.getElementById("admin-sidebar").classList.toggle("is-open");
    });

    document.getElementById("customer-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const payload = validateCustomerForm();
      if (!payload) return;

      showLoading(true);
      let res, data;
      if (editingCustomerId) {
        ({ res, data } = await apiFetch("/customers/" + editingCustomerId, {
          method: "PUT",
          body: JSON.stringify(payload),
        }));
      } else {
        ({ res, data } = await apiFetch("/customers", {
          method: "POST",
          body: JSON.stringify(payload),
        }));
      }
      showLoading(false);

      if (!res.ok) {
        const msg =
          data.error || (data.errors && data.errors.join(" ")) || "Lưu thất bại.";
        showToast(msg, "error");
        return;
      }

      showToast(editingCustomerId ? "Đã cập nhật." : "Đã thêm khách hàng.", "success");
      resetCustomerForm();
      await loadCustomers();
      await refreshDashboard();
    });

    document.getElementById("customer-cancel").addEventListener("click", resetCustomerForm);

    document.querySelectorAll("#customers-filters .admin-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#customers-filters .admin-filter").forEach(function (b) {
          b.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        customersFilter = btn.getAttribute("data-filter");
        loadCustomers();
      });
    });

    document.getElementById("customers-search").addEventListener("input", function () {
      clearTimeout(searchCustomersTimer);
      searchCustomersTimer = setTimeout(loadCustomers, 300);
    });

    document.querySelectorAll("#requests-filters .admin-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#requests-filters .admin-filter").forEach(function (b) {
          b.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        requestsStatusFilter = btn.getAttribute("data-status");
        loadRequests();
      });
    });

    document.getElementById("requests-search").addEventListener("input", function () {
      clearTimeout(searchRequestsTimer);
      searchRequestsTimer = setTimeout(loadRequests, 300);
    });
  }

  async function init() {
    bindEvents();
    showLoading(true);
    const loggedIn = await checkAuth();
    showLoading(false);

    if (loggedIn) {
      showApp();
      switchView("dashboard");
    } else {
      showLoginOnly();
    }
    console.log("Admin ready — customers + customer_requests");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
