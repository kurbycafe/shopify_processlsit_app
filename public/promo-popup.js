/**
 * Dawayo Storefront Feature Announcement Promo Modal Script (DAWAYO Brand Style)
 * Matches DAWAYO.de Asian Food Mall brand design system.
 */
(function () {
  if (window.__DAWAYO_PROMO_MODAL_LOADED__) return;
  window.__DAWAYO_PROMO_MODAL_LOADED__ = true;

  const SCRIPT_HOST = (function () {
    if (document.currentScript && document.currentScript.src) {
      try {
        return new URL(document.currentScript.src).origin;
      } catch (e) {}
    }
    return "https://process-list-beryl.vercel.app";
  })();

  const API_ENDPOINT = SCRIPT_HOST + "/api/storefront-notice";

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  async function initPromoModal() {
    const host = location.hostname;
    const path = location.pathname;

    const isMainPage = (path === "/" || path === "" || path === "/index.html");
    const isTargetDomain = host === "dawayo.de" || host.endsWith(".dawayo.de") || host.endsWith(".myshopify.com");

    if (!isTargetDomain || (!isMainPage && !(host === "dawayo.de" || host.endsWith(".dawayo.de")))) return;

    try {
      const res = await fetch(`${API_ENDPOINT}?shop=${encodeURIComponent(window.Shopify?.shop || host)}`);
      if (!res.ok) return;
      const payload = await res.json();
      const data = payload.data;
      if (!payload.success || !data?.isActive) return;

      const noticeVersion = data.noticeVersion || "v1.3.0";
      let isDismissed = false;
      try { isDismissed = localStorage.getItem("dawayo_promo_dismissed_version") === noticeVersion; } catch { /* Storage can be disabled. */ }

      if (isDismissed) return;

      const badgeTag = data.badgeTag || "NEW ANNOUNCEMENT";
      const title = data.title || "다와요(Dawayo) 서비스 안내";
      const subtext = data.subtext || "고객님께 더 빠르고 정확한 서비스를 제공하기 위해 시스템이 업데이트되었습니다.";
      const items = Array.isArray(data.items) ? data.items : [];

      if (!document.getElementById("dawayo-promo-style")) {
        const style = document.createElement("style");
        style.id = "dawayo-promo-style";
        style.textContent = `
          .dawayo-promo-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(17, 24, 39, 0.72);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999999;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            padding: 16px;
            box-sizing: border-box;
          }
          .dawayo-promo-overlay.active {
            opacity: 1;
            pointer-events: auto;
          }
          .dawayo-promo-modal {
            background: #ffffff;
            width: 100%;
            max-width: 480px;
            border-radius: 18px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
            overflow: hidden;
            transform: scale(0.92) translateY(12px);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            font-family: "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #111827;
          }
          .dawayo-promo-overlay.active .dawayo-promo-modal {
            transform: scale(1) translateY(0);
          }
          .dawayo-promo-header-bg {
            background: linear-gradient(135deg, #e11d48 0%, #be123c 60%, #9f1239 100%);
            padding: 24px 22px 20px 22px;
            color: #ffffff;
            position: relative;
          }
          .dawayo-promo-header-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
          }
          .dawayo-brand-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #ffffff;
            color: #e11d48;
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 900;
            font-size: 13px;
            letter-spacing: -0.3px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.12);
          }
          .dawayo-brand-badge .de-tag {
            background: #e11d48;
            color: #ffffff;
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: 700;
          }
          .dawayo-promo-close-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 18px;
            color: #ffffff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
            line-height: 1;
          }
          .dawayo-promo-close-btn:hover {
            background: rgba(255, 255, 255, 0.35);
          }
          .dawayo-promo-tag {
            display: inline-block;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.35);
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            padding: 3px 8px;
            border-radius: 4px;
            margin-bottom: 8px;
          }
          .dawayo-promo-title {
            margin: 0;
            font-size: 20px;
            font-weight: 800;
            line-height: 1.35;
            letter-spacing: -0.3px;
          }
          .dawayo-promo-body {
            padding: 22px 22px 14px 22px;
          }
          .dawayo-promo-subtext {
            font-size: 14px;
            color: #4b5563;
            margin: 0 0 18px 0;
            line-height: 1.55;
          }
          .dawayo-promo-list {
            list-style: none;
            padding: 0;
            margin: 0 0 16px 0;
          }
          .dawayo-promo-list li {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
            font-size: 14px;
            line-height: 1.55;
            color: #1f2937;
          }
          .dawayo-promo-icon {
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            background: #ffe4e6;
            color: #e11d48;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: bold;
          }
          .dawayo-promo-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 16px 22px;
            background: #f9fafb;
            border-top: 1px solid #f3f4f6;
          }
          .dawayo-promo-confirm-btn {
            background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
            color: #ffffff;
            border: none;
            width: 100%;
            padding: 13px;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(225, 29, 72, 0.35);
            transition: all 0.2s;
            text-align: center;
          }
          .dawayo-promo-confirm-btn:hover {
            background: linear-gradient(135deg, #be123c 0%, #9f1239 100%);
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(225, 29, 72, 0.45);
          }
        `;
        document.head.appendChild(style);
      }

      let itemsHtml = "";
      items.forEach((it) => {
        const itemTitle = typeof it === "string" ? it : it?.title;
        const itemDesc = typeof it === "string" ? "" : it?.desc;
        itemsHtml += `
          <li>
            <div class="dawayo-promo-icon">✓</div>
            <div>${itemTitle ? `<strong>${escapeHtml(itemTitle)}:</strong> ` : ""}${escapeHtml(itemDesc || "")}</div>
          </li>
        `;
      });

      if (document.querySelector(".dawayo-promo-overlay")) return;
      const overlay = document.createElement("div");
      overlay.className = "dawayo-promo-overlay";
      overlay.innerHTML = `
        <div class="dawayo-promo-modal">
          <div class="dawayo-promo-header-bg">
            <div class="dawayo-promo-header-top">
              <div class="dawayo-brand-badge">
                DAWAYO <span class="de-tag">.de</span>
              </div>
              <button class="dawayo-promo-close-btn" aria-label="Close">&times;</button>
            </div>
            <div>
              <span class="dawayo-promo-tag">${escapeHtml(badgeTag)}</span>
              <h3 class="dawayo-promo-title">${escapeHtml(title)}</h3>
            </div>
          </div>
          <div class="dawayo-promo-body">
            ${subtext ? `<p class="dawayo-promo-subtext">${escapeHtml(subtext)}</p>` : ""}
            <ul class="dawayo-promo-list">
              ${itemsHtml}
            </ul>
          </div>
          <div class="dawayo-promo-footer">
            <button class="dawayo-promo-confirm-btn">확인했습니다</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      setTimeout(() => {
        overlay.classList.add("active");
      }, 400);

      const closeBtn = overlay.querySelector(".dawayo-promo-close-btn");
      const confirmBtn = overlay.querySelector(".dawayo-promo-confirm-btn");

      const dismissModal = () => {
        try { localStorage.setItem("dawayo_promo_dismissed_version", noticeVersion); } catch { /* Still close if storage is blocked. */ }
        overlay.classList.remove("active");
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 350);
      };

      closeBtn.addEventListener("click", dismissModal);
      confirmBtn.addEventListener("click", dismissModal);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) dismissModal();
      });
    } catch (err) {
      console.warn("[Storefront Promo Modal] Failed to load notice:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPromoModal);
  } else {
    initPromoModal();
  }
})();
