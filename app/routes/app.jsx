import { useEffect, useRef } from "react";
import { Outlet, useLoaderData, useFetcher, useRouteError, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { waitUntil } from "@vercel/functions";
import shopify, { authenticate } from "../shopify.server";
import { ensureRequiredWebhooksInBackground } from "../services/webhookRegistration.server.js";

import operationsStyles from "../styles/operations.css?url";

export const links = () => [{ rel: "stylesheet", href: operationsStyles }];

// Order webhooks deliver cancellation and return requests in real time; this
// poll only catches what a missed webhook would otherwise lose.
const CANCELLATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (session?.shop) {
    // Keep the offline session fresh for background webhooks, without making
    // every admin page wait for it.
    shopify.unauthenticated.admin(session.shop).catch((offlineErr) => {
      console.warn("[App Root] Offline session health check blip:", offlineErr?.message);
    });

    // Re-register any missing order/fulfillment/inventory webhook in the background.
    const appUrl = process.env.SHOPIFY_APP_URL;
    if (appUrl) {
      const registering = ensureRequiredWebhooksInBackground(admin, session.shop, appUrl);
      if (typeof waitUntil === "function") waitUntil(registering);
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const checkFetcher = useFetcher();
  const location = useLocation();
  const lastLoggedPathRef = useRef("");

  useEffect(() => {
    const currentPath = location.pathname;
    if (!currentPath || currentPath === lastLoggedPathRef.current) return;
    lastLoggedPathRef.current = currentPath;

    let savedInspector = "";
    try {
      savedInspector = localStorage.getItem("dawayo_inspector_name") || "";
    } catch {}

    const fd = new FormData();
    fd.append("path", currentPath);
    if (savedInspector) fd.append("user", savedInspector);

    fetch("/api/log-tab", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    }).catch(() => {});
  }, [location.pathname]);

  const checkRef = useRef(checkFetcher);
  checkRef.current = checkFetcher;
  useEffect(() => {
    let lastStarted = 0;
    const poll = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine || checkRef.current.state !== 'idle') return;
      if (Date.now() - lastStarted < CANCELLATION_POLL_INTERVAL_MS) return;
      lastStarted = Date.now();
      checkRef.current.load('/api/check-cancellations');
    };
    // Keep maintenance in a separate awaited HTTP request, not the page loader.
    poll();
    const interval = setInterval(poll, CANCELLATION_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('online', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('online', poll);
    };
  }, []);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">대시보드</s-link>
        <s-link href="/app/inspect">주문 검수</s-link>
        <s-link href="/app/pick-list">처리중 리스트</s-link>
        <s-link href="/app/lieferschein">납품서(Lieferschein)</s-link>
        <s-link href="/app/inspection-history">검수 내역</s-link>
        <s-link href="/app/back-in-stock">재입고 수요 관리</s-link>
        <s-link href="/app/container-catalog">컨테이너 입고</s-link>
        {/* <s-link href="/app/inventory">월별 재고 보고서</s-link> */}
        {/* <s-link href="/app/store-label">매장 라벨 인쇄</s-link> */}
        <s-link href="/app/app-management">앱 관리</s-link>
        <s-link href="/app/app-requests">앱 개선 요청</s-link>
        {/* <s-link href="/app/notice">스토어 공지</s-link> */}
        <s-link href="/app/settings">시스템 연동 설정</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
