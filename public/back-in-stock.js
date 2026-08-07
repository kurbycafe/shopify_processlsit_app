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

  // 모달 HTML 생성 (웹 푸시 1-Click 중심 UX)
  const modalContainer = document.createElement("div");
  modalContainer.className = "pl-bis-modal-overlay";
  modalContainer.innerHTML = `
    <div class="pl-bis-modal">
      <button class="pl-bis-modal-close" id="pl-bis-close">&times;</button>
      <h3>재입고 알림 신청</h3>
      <p id="pl-bis-desc">상품이 재입고되는 즉시 실시간 푸시 팝업 또는 이메일로 안내해 드립니다.</p>
      <div id="pl-bis-eta" class="pl-bis-eta-badge" style="display: none;"></div>
      
      <button type="button" id="pl-bis-push-btn" class="pl-bis-push-btn">
        원클릭 웹 푸시 알림 신청
      </button>

      <div class="pl-bis-divider"><span>또는 이메일 수신</span></div>

      <form id="pl-bis-form">
        <input type="email" id="pl-bis-email" class="pl-bis-input" placeholder="이메일 주소를 입력하세요 (선택)" />
        <button type="submit" id="pl-bis-submit" class="pl-bis-submit-btn">이메일 알림 신청하기</button>
      </form>
      <div id="pl-bis-msg" class="pl-bis-msg"></div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  const closeBtn = document.getElementById("pl-bis-close");
  const pushBtn = document.getElementById("pl-bis-push-btn");
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

  // 1-Click 웹 푸시 알림 이벤트 처리
  pushBtn.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      msgDiv.className = "pl-bis-msg error";
      msgDiv.textContent = "이 브라우저는 웹 푸시 알림을 지원하지 않습니다. 이메일 입력을 이용해 주세요.";
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        msgDiv.className = "pl-bis-msg error";
        msgDiv.textContent = "알림 권한이 차단되었습니다. 브라우저 설정에서 알림을 허용해 주시거나 이메일 입력을 이용해 주세요.";
        return;
      }

      pushBtn.disabled = true;
      pushBtn.textContent = "푸시 신청 처리 중...";
      msgDiv.textContent = "";

      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: currentContext.shop,
          email: emailInput.value.trim() || `push_user@${location.hostname}`,
          channel: "PUSH",
          variantId: currentContext.variantId,
          productId: currentContext.productId,
          productTitle: currentContext.productTitle,
          variantTitle: currentContext.variantTitle,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // 브라우저 데스크톱 테스트 푸시 알림 트리거
        try {
          new Notification(`[다와요] ${currentContext.productTitle} 알림 신청 완료`, {
            body: "상품이 재입고되면 이 브라우저로 실시간 알람이 수신됩니다.",
          });
        } catch (e) {}

        msgDiv.className = "pl-bis-msg success";
        msgDiv.textContent = "웹 푸시 알림이 성공적으로 등록되었습니다.";
        setTimeout(() => {
          modalContainer.classList.remove("active");
          msgDiv.textContent = "";
          pushBtn.disabled = false;
          pushBtn.textContent = "원클릭 웹 푸시 알림 신청";
        }, 2200);
      } else {
        msgDiv.className = "pl-bis-msg error";
        msgDiv.textContent = data.error || "신청 중 오류가 발생했습니다.";
        pushBtn.disabled = false;
        pushBtn.textContent = "원클릭 웹 푸시 알림 신청";
      }
    } catch (err) {
      console.error("Web Push error:", err);
      msgDiv.className = "pl-bis-msg error";
      msgDiv.textContent = "웹 푸시 신청 중 오류가 발생했습니다.";
      pushBtn.disabled = false;
      pushBtn.textContent = "원클릭 웹 푸시 알림 신청";
    }
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
        msgDiv.textContent = data.error || "신청 중 오류가 발생했습니다.";
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
              etaDate = infoData.etaDate;
              subscriberCount = infoData.subscriberCount || 0;
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})();
