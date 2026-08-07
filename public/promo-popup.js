/**
 * Dawayo Storefront Feature Announcement Promo Modal Script (Strict 1-Time Display)
 * Dynamically fetches notice content from Shopify backend API (/api/storefront-notice).
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

  async function initPromoModal() {
    const host = location.hostname;
    const path = location.pathname;

    const isMainPage = (path === "/" || path === "" || path === "/index.html");
    const isTargetDomain = host.includes("dawayo.de") || host.includes("myshopify.com") || location.search.includes("preview_theme_id");

    if (!isMainPage && !host.includes("dawayo.de")) return;

    try {
      const res = await fetch(`${API_ENDPOINT}?shop=${encodeURIComponent(host)}`);
      if (!res.ok) return;
      const data = await res.json();

      if (!data.success || !data.isActive) return;

      const noticeVersion = data.noticeVersion || "v1.3.0";
      const isDismissed = localStorage.getItem("dawayo_promo_dismissed_version") === noticeVersion;

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
            background: rgba(15, 23, 42, 0.75);
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
            border-radius: 20px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
            overflow: hidden;
            transform: scale(0.92) translateY(12px);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
          }
          .dawayo-promo-overlay.active .dawayo-promo-modal {
            transform: scale(1) translateY(0);
          }
          .dawayo-promo-header-bg {
            background: linear-gradient(135deg, #059669 0%, #047857 50%, #064e3b 100%);
            padding: 26px 22px 22px 22px;
            color: #ffffff;
            position: relative;
          }
          .dawayo-promo-close-btn {
            position: absolute;
            top: 14px;
            right: 14px;
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
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            padding: 4px 10px;
            border-radius: 20px;
            margin-bottom: 10px;
          }
          .dawayo-promo-title {
            margin: 0;
            font-size: 21px;
            font-weight: 800;
            line-height: 1.35;
            letter-spacing: -0.3px;
          }
          .dawayo-promo-body {
            padding: 22px 22px 14px 22px;
          }
          .dawayo-promo-subtext {
            font-size: 14px;
            color: #475569;
            margin: 0 0 18px 0;
            line-height: 1.5;
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
            line-height: 1.5;
            color: #334155;
          }
          .dawayo-promo-icon {
            flex-shrink: 0;
            width: 26px;
            height: 26px;
            background: #ecfdf5;
            color: #059669;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
          }
          .dawayo-promo-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 16px 22px;
            background: #f8fafc;
            border-top: 1px solid #f1f5f9;
          }
          .dawayo-promo-confirm-btn {
            background: #059669;
            color: #ffffff;
            border: none;
            width: 100%;
            padding: 12px;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25);
            transition: all 0.2s;
            text-align: center;
          }
          .dawayo-promo-confirm-btn:hover {
            background: #047857;
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(5, 150, 105, 0.35);
          }
        `;
        document.head.appendChild(style);
      }

      let itemsHtml = "";
      items.forEach((it) => {
        const itemTitle = typeof it === "string" ? it : it.title;
        const itemDesc = typeof it === "string" ? "" : it.desc;
        itemsHtml += `
          <li>
            <div class="dawayo-promo-icon">✓</div>
            <div>${itemTitle ? `<strong>${itemTitle}:</strong> ` : ""}${itemDesc || ""}</div>
          </li>
        `;
      });

      const overlay = document.createElement("div");
      overlay.className = "dawayo-promo-overlay";
      overlay.innerHTML = `
        <div class="dawayo-promo-modal">
          <div class="dawayo-promo-header-bg">
            <button class="dawayo-promo-close-btn" aria-label="Close">&times;</button>
            <span class="dawayo-promo-tag">${badgeTag}</span>
            <h3 class="dawayo-promo-title">${title}</h3>
          </div>
          <div class="dawayo-promo-body">
            ${subtext ? `<p class="dawayo-promo-subtext">${subtext}</p>` : ""}
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

      function dismissModal() {
        localStorage.setItem("dawayo_promo_dismissed_version", noticeVersion);
        overlay.classList.remove("active");
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 350);
      }

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
