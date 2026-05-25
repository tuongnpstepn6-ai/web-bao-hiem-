/**
 * api-config.js — Base URL API dùng chung (frontend + admin)
 * Local / Render: cùng origin. Vercel: meta api-base hoặc RENDER_API_ORIGIN.
 */
(function (global) {
  "use strict";

  var RENDER_API_ORIGIN = "https://web-bao-hiem.onrender.com";

  function readMetaApiBase() {
    if (!global.document) return "";
    var meta = global.document.querySelector('meta[name="api-base"]');
    if (!meta || !meta.content) return "";
    var url = meta.content.trim();
    if (!url || url === "/" || url === ".") return "";
    return url.replace(/\/$/, "");
  }

  function isSameOriginHost(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".onrender.com")
    );
  }

  function getApiBaseUrl() {
    var h = global.location && global.location.hostname;
    if (!h) return "";
    if (isSameOriginHost(h)) {
      return "";
    }
    var fromMeta = readMetaApiBase();
    if (fromMeta) return fromMeta;
    return RENDER_API_ORIGIN;
  }

  global.getApiBaseUrl = getApiBaseUrl;
  global.RENDER_API_ORIGIN = RENDER_API_ORIGIN;
})(typeof window !== "undefined" ? window : global);
