/**
 * Process-list Back-In-Stock Notification Storefront Script
 * Embedded on Shopify Product Pages to allow customers to subscribe to out-of-stock items.
 */
(function () {
  if (window.__PROCESS_LIST_BIS_LOADED__) return;
  window.__PROCESS_LIST_BIS_LOADED__ = true;

  const SCRIPT_HOST = (function () {
    if (document.currentScript && document.currentScript.src) {
      try {
        return new URL(document.currentScript.src).origin;
      } catch (e) {}
    }
    return "https://process-list-beryl.vercel.app";
  })();

  const API_ENDPOINT = SCRIPT_HOST + "/api/back-in-stock/subscribe";

  // CSS 스타일 자동 주입 (매끄럽고 세련된 모달 & 버튼 디자인)
  const style = document.createElement("style");
  style.textContent = `
    .pl-bis-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px 20px;
      margin-top: 10px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
      transition: all 0.2s ease-in-out;
    }
    .pl-bis-btn:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
    }

    .pl-bis-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .pl-bis-modal-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }

    .pl-bis-modal {
      background: #ffffff;
      width: 90%;
      max-width: 440px;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      transform: scale(0.95);
      transition: transform 0.25s ease;
      position: relative;
    }
    .pl-bis-modal-overlay.active .pl-bis-modal {
      transform: scale(1);
    }

    .pl-bis-modal-close {
      position: absolute;
      top: 16px;
      right: 16px;
      background: #f3f4f6;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      color: #6b7280;
    }

    .pl-bis-modal h3 {
      margin: 0 0 8px 0;
      font-size: 20px;
      font-weight: 700;
      color: #111827;
    }
    .pl-bis-modal p {
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #4b5563;
      line-height: 1.5;
    }

    .pl-bis-eta-badge {
      display: inline-block;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .pl-bis-input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 15px;
      margin-bottom: 12px;
      box-sizing: border-box;
    }
    .pl-bis-input:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }

    .pl-bis-submit-btn {
      width: 100%;
      padding: 12px;
      background: #2563eb;
      color: white;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    .pl-bis-submit-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .pl-bis-msg {
      margin-top: 12px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
    }
    .pl-bis-push-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 14px 20px;
      margin-bottom: 14px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
      transition: all 0.2s ease-in-out;
    }
    .pl-bis-push-btn:hover {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
    }
    .pl-bis-push-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .pl-bis-divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 16px 0;
      color: #94a3b8;
      font-size: 12px;
    }
    .pl-bis-divider::before, .pl-bis-divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #e2e8f0;
    }
    .pl-bis-divider span {
      padding: 0 10px;
    }

    .pl-bis-social-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      margin-top: 8px;
      padding: 8px 12px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      box-sizing: border-box;
      text-align: center;
    }
    .pl-bis-social-badge.high-demand {
      background: #fff7ed;
      color: #c2410c;
      border-color: #ffedd5;
    }

    .pl-bis-sub-cancel-link {
      display: block;
      width: 100%;
      text-align: center;
      background: transparent;
      border: none;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 4px;
      text-decoration: underline;
    }
    .pl-bis-sub-cancel-link:hover {
      color: #dc2626;
    }

    .pl-bis-cancel-btn {
      padding: 12px;
      background: #f1f5f9;
      color: #475569;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .pl-bis-cancel-btn:hover {
      background: #fee2e2;
      color: #dc2626;
      border-color: #fecaca;
    }

    .pl-bis-msg {
      margin-top: 12px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
    }
    .pl-bis-msg.success { color: #16a34a; }
    .pl-bis-msg.error { color: #dc2626; }
  `;
  document.head.appendChild(style);

  // 모달 HTML 생성 (웹 푸시 1-Click 중심 UX + 알림 취소 옵션)
  const modalContainer = document.createElement("div");
  modalContainer.className = "pl-bis-modal-overlay";
  modalContainer.innerHTML = `
    <div class="pl-bis-modal">
      <button class="pl-bis-modal-close" id="pl-bis-close">&times;</button>
      <h3>재입고 알림 신청</h3>
      <p id="pl-bis-desc">현재 이메일 알림만 지원합니다. 재입고 시 입력한 이메일로 안내해 드립니다.</p>
      <div id="pl-bis-eta" class="pl-bis-eta-badge" style="display: none;"></div>
      
      <form id="pl-bis-form">
        <input type="email" id="pl-bis-email" class="pl-bis-input" placeholder="이메일 주소를 입력하세요" />
        <div style="display: flex; gap: 8px;">
          <button type="submit" id="pl-bis-submit" class="pl-bis-submit-btn" style="flex: 2;">이메일 알림 신청</button>

        </div>
      </form>
      <p style="font-size: 12px; color: #6b7280;">알림 수신을 중단하려면 <a href="mailto:service@dawayo.de">고객센터(service@dawayo.de)</a>로 신청한 이메일과 상품명을 보내 주세요.</p>
      <div id="pl-bis-msg" class="pl-bis-msg"></div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  const closeBtn = document.getElementById("pl-bis-close");
  const form = document.getElementById("pl-bis-form");
  const emailInput = document.getElementById("pl-bis-email");
  const submitBtn = document.getElementById("pl-bis-submit");
  const msgDiv = document.getElementById("pl-bis-msg");
  const etaDiv = document.getElementById("pl-bis-eta");

  let currentContext = {
    productId: null,
    variantId: null,
    productTitle: null,
    variantTitle: null,
    shop: window.Shopify ? window.Shopify.shop : location.hostname,
  };

  closeBtn.addEventListener("click", () => {
    modalContainer.classList.remove("active");
  });

  modalContainer.addEventListener("click", (e) => {
    if (e.target === modalContainer) modalContainer.classList.remove("active");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      msgDiv.className = "pl-bis-msg error";
      msgDiv.textContent = "이메일 주소를 입력해 주세요.";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "신청 처리 중...";
    msgDiv.textContent = "";

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: currentContext.shop,
          email: email,
          channel: "EMAIL",
          variantId: currentContext.variantId,
          productId: currentContext.productId,
          productTitle: currentContext.productTitle,
          variantTitle: currentContext.variantTitle,
        }),
      });

      const data = await res.json();
      if (data.success) {
        msgDiv.className = "pl-bis-msg success";
        msgDiv.textContent = data.message || "이메일 알림 신청이 완료되었습니다.";
        setTimeout(() => {
          modalContainer.classList.remove("active");
          emailInput.value = "";
          msgDiv.textContent = "";
          submitBtn.disabled = false;
          submitBtn.textContent = "이메일 알림 신청하기";
        }, 2000);
      } else {
        msgDiv.className = "pl-bis-msg error";
        msgDiv.textContent = (typeof data.error === "string" ? data.error : data.error?.message) || "신청 중 오류가 발생했습니다.";
        submitBtn.disabled = false;
        submitBtn.textContent = "이메일 알림 신청하기";
      }
    } catch (err) {
      console.error("Back in stock error:", err);
      msgDiv.className = "pl-bis-msg error";
      msgDiv.textContent = "네트워크 오류가 발생했습니다.";
      submitBtn.disabled = false;
      submitBtn.textContent = "이메일 알림 신청하기";
    }
  });

  // 쇼피파이 상품 페이지 자동 감지 및 버튼 삽입
  window.initProcessListBackInStock = function (config) {
    currentContext = { ...currentContext, ...config };

    const targetContainer = document.querySelector(".product-form, .product-single__meta, form[action*='/cart/add']");
    if (!targetContainer) return;

    let existingBtn = document.getElementById("pl-bis-trigger");
    if (!existingBtn) {
      existingBtn = document.createElement("button");
      existingBtn.id = "pl-bis-trigger";
      existingBtn.type = "button";
      existingBtn.className = "pl-bis-btn";
      existingBtn.innerHTML = `재입고 알림 받아보기`;
      targetContainer.appendChild(existingBtn);
    }

    let socialBadge = document.getElementById("pl-bis-social-badge");
    if (config.subscriberCount && config.subscriberCount > 0) {
      if (!socialBadge) {
        socialBadge = document.createElement("div");
        socialBadge.id = "pl-bis-social-badge";
        targetContainer.appendChild(socialBadge);
      }

      if (config.subscriberCount >= 10) {
        socialBadge.className = "pl-bis-social-badge high-demand";
        socialBadge.textContent = `현재 ${config.subscriberCount}명이 신청함 (재입고 인기가 높은 제품입니다)`;
      } else {
        socialBadge.className = "pl-bis-social-badge";
        socialBadge.textContent = `현재 ${config.subscriberCount}명이 재입고 알림을 신청했습니다.`;
      }
    } else if (socialBadge) {
      socialBadge.remove();
    }

    existingBtn.onclick = () => {
      let badgeText = "";
      if (config.etaDate) {
        badgeText += `입고 예정일: ${config.etaDate}`;
      }
      if (config.subscriberCount && config.subscriberCount > 0) {
        if (badgeText) badgeText += ` | `;
        if (config.subscriberCount >= 10) {
          badgeText += `현재 ${config.subscriberCount}명 대기 중 (인기 품목)`;
        } else {
          badgeText += `현재 ${config.subscriberCount}명이 신청함`;
        }
      }

      if (badgeText) {
        etaDiv.style.display = "inline-block";
        etaDiv.textContent = badgeText;
      } else {
        etaDiv.style.display = "none";
      }
      modalContainer.classList.add("active");
    };
  };

  // 상품 페이지 자동 감지 및 품절 시 알림 버튼 자동 노출
  async function autoInit() {
    if (!location.pathname.includes("/products/")) return;

    try {
      const productUrl = location.pathname.split("?")[0] + ".js";
      const res = await fetch(productUrl);
      if (!res.ok) return;
      const product = await res.json();

      const urlParams = new URLSearchParams(location.search);
      const variantParam = urlParams.get("variant");

      let targetVariant = null;
      if (variantParam) {
        targetVariant = product.variants ? product.variants.find((v) => String(v.id) === String(variantParam)) : null;
      }
      if (!targetVariant && product.variants && product.variants.length > 0) {
        targetVariant = product.variants[0];
      }

      const isSoldOut = targetVariant ? !targetVariant.available : !product.available;

      if (isSoldOut) {
        const variantId = targetVariant ? String(targetVariant.id) : String(product.id);
        const sku = targetVariant ? targetVariant.sku : "";
        const shop = window.Shopify ? window.Shopify.shop : location.hostname;

        let etaDate = null;
        let subscriberCount = 0;

        try {
          const infoRes = await fetch(`${API_ENDPOINT}?variantId=${encodeURIComponent(variantId)}&sku=${encodeURIComponent(sku || "")}&shop=${encodeURIComponent(shop)}`);
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.success) {
              etaDate = infoData.data?.etaDate || null;
            }
          }
        } catch (e) {
          console.warn("[BIS] Info fetch warning:", e);
        }

        window.initProcessListBackInStock({
          productId: String(product.id),
          variantId: variantId,
          productTitle: product.title,
          variantTitle: targetVariant && targetVariant.title !== "Default Title" ? targetVariant.title : null,
          shop: shop,
          etaDate: etaDate,
          subscriberCount: subscriberCount,
        });
      }
    } catch (err) {
      console.warn("[BIS] Auto init check failed:", err);
    }
  }

  // 스토어프론트 (고객 화면) 신규 기능 1회성 홍보 모달 (dawayo.de 메인화면 특정)
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  async function initStorefrontPromoModal() {
    const host = location.hostname;
    const path = location.pathname;

    const isMainPage = (path === "/" || path === "" || path === "/index.html");
    const isTargetDomain = host === "dawayo.de" || host.endsWith(".dawayo.de") || host.endsWith(".myshopify.com");

    if (!isTargetDomain || (!isMainPage && !(host === "dawayo.de" || host.endsWith(".dawayo.de")))) return;

    const PROMO_API = SCRIPT_HOST + "/api/storefront-notice";

    try {
      const res = await fetch(`${PROMO_API}?shop=${encodeURIComponent(window.Shopify?.shop || host)}`);
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
    } catch (e) {
      console.warn("[Storefront Promo Modal] Notice fetch error:", e);
    }
  }

  function startInit() {
    autoInit();
    initStorefrontPromoModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startInit);
  } else {
    startInit();
  }
})();
