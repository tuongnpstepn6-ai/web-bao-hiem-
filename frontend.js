/**
 * frontend.js — Trang khách: gửi yêu cầu bảo hiểm xe mô tô / ô tô
 */
(function () {
  "use strict";

  const API_URL =
    typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "";
  const PHONE_REGEX = /^(0|\+84)[0-9]{8,11}$/;

  const SUCCESS_MSG =
    "Đã nhận được yêu cầu của quý khách. Nhân viên sẽ sớm liên hệ tư vấn.";

  function onDomReady() {
    console.log("Frontend ready");
    initNavScroll();
    initMobileNav();
    initSmoothScroll();
    initRequestForm();
    initPopup();
    initFooterYear();
  }

  function initNavScroll() {
    const header = document.getElementById("site-header");
    if (!header) return;
    function updateScrolled() {
      header.classList.toggle("is-scrolled", window.scrollY > 16);
    }
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
  }

  function initMobileNav() {
    const header = document.getElementById("site-header");
    const toggle = document.getElementById("nav-toggle");
    const menu = document.getElementById("nav-menu");
    if (!header || !toggle || !menu) return;

    function setOpen(open) {
      header.classList.toggle("nav-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
      document.body.style.overflow = open ? "hidden" : "";
    }

    toggle.addEventListener("click", function () {
      setOpen(!header.classList.contains("nav-open"));
    });

    menu.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function () {
        if (window.matchMedia("(max-width: 768px)").matches) setOpen(false);
      });
    });

    window.addEventListener("resize", function () {
      if (!window.matchMedia("(max-width: 768px)").matches) setOpen(false);
    });
  }

  function initSmoothScroll() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener("click", function (e) {
        const id = this.getAttribute("href");
        if (!id || id === "#") return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const header = document.getElementById("site-header");
        const offset = header ? header.offsetHeight : 0;
        const top = target.getBoundingClientRect().top + window.scrollY - offset - 8;
        window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
      });
    });
  }

  /** Toast góc màn hình */
  function showToast(message) {
    const toast = document.getElementById("site-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "site-toast site-toast--show";
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.classList.remove("site-toast--show");
      toast.hidden = true;
    }, 4500);
  }

  /** Popup thành công */
  function showPopup(message) {
    const popup = document.getElementById("site-popup");
    const msgEl = document.getElementById("popup-message");
    if (!popup) return;
    if (msgEl) msgEl.textContent = message || SUCCESS_MSG;
    popup.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function hidePopup() {
    const popup = document.getElementById("site-popup");
    if (!popup) return;
    popup.hidden = true;
    document.body.style.overflow = "";
  }

  function initPopup() {
    const closeBtn = document.getElementById("popup-close");
    const backdrop = document.getElementById("popup-backdrop");
    if (closeBtn) closeBtn.addEventListener("click", hidePopup);
    if (backdrop) backdrop.addEventListener("click", hidePopup);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hidePopup();
    });
  }

  function initRequestForm() {
    const form = document.getElementById("request-form");
    if (!form) return;

    const apiErrorEl = document.getElementById("form-api-error");
    const submitBtn = document.getElementById("request-submit");

    const fields = [
      {
        id: "ten-khach-hang",
        errorId: "error-ten-khach-hang",
        validate: function (v) {
          return v.trim() ? "" : "Vui lòng nhập tên khách hàng.";
        },
      },
      {
        id: "so-dien-thoai",
        errorId: "error-so-dien-thoai",
        validate: function (v) {
          const phone = v.trim().replace(/\s/g, "");
          if (!phone) return "Vui lòng nhập số điện thoại.";
          if (!PHONE_REGEX.test(phone)) return "Số điện thoại không hợp lệ.";
          return "";
        },
      },
      {
        id: "bien-so",
        errorId: "error-bien-so",
        validate: function (v) {
          return v.trim() ? "" : "Vui lòng nhập biển số xe.";
        },
      },
    ];

    function clearErrors() {
      fields.forEach(function (f) {
        const input = document.getElementById(f.id);
        const err = document.getElementById(f.errorId);
        if (input) input.removeAttribute("aria-invalid");
        if (err) err.textContent = "";
      });
      if (apiErrorEl) {
        apiErrorEl.hidden = true;
        apiErrorEl.textContent = "";
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErrors();

      let firstInvalid = null;
      fields.forEach(function (f) {
        const input = document.getElementById(f.id);
        if (!input) return;
        const msg = f.validate(input.value);
        if (msg) {
          input.setAttribute("aria-invalid", "true");
          const err = document.getElementById(f.errorId);
          if (err) err.textContent = msg;
          if (!firstInvalid) firstInvalid = input;
        }
      });

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const payload = {
        tenKhachHang: document.getElementById("ten-khach-hang").value.trim(),
        soDienThoai: document
          .getElementById("so-dien-thoai")
          .value.trim()
          .replace(/\s/g, ""),
        bienSo: document.getElementById("bien-so").value.trim(),
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang gửi...";
      }

      fetch(API_URL + "/customer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data && result.data.success) {
            form.reset();
            showToast(SUCCESS_MSG);
            showPopup(SUCCESS_MSG);
            return;
          }
          const msg =
            (result.data && (result.data.error || (result.data.errors && result.data.errors.join(" ")))) ||
            "Gửi yêu cầu thất bại. Vui lòng thử lại.";
          if (apiErrorEl) {
            apiErrorEl.textContent = msg;
            apiErrorEl.hidden = false;
          } else {
            showToast(msg);
          }
        })
        .catch(function () {
          const msg =
            "Không kết nối được máy chủ. Kiểm tra backend (npm start hoặc URL Render trong api-config).";
          if (apiErrorEl) {
            apiErrorEl.textContent = msg;
            apiErrorEl.hidden = false;
          } else {
            showToast(msg);
          }
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Gửi yêu cầu bảo hiểm";
          }
        });
    });
  }

  function initFooterYear() {
    const el = document.getElementById("year");
    if (el) el.textContent = String(new Date().getFullYear());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onDomReady);
  } else {
    onDomReady();
  }
})();
