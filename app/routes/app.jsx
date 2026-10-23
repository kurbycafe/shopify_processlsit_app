import { useEffect, useRef } from "react";
import { Outlet, useLoaderData, useFetcher, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

import operationsStyles from "../styles/operations.css?url";

export const links = () => [{ rel: "stylesheet", href: operationsStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const checkFetcher = useFetcher();

  const checkRef = useRef(checkFetcher);
  checkRef.current = checkFetcher;
  useEffect(() => {
    let lastStarted = 0;
    const poll = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine || checkRef.current.state !== 'idle') return;
      if (Date.now() - lastStarted < 25000) return;
      lastStarted = Date.now();
      checkRef.current.load('/api/check-cancellations');
    };
    // Keep maintenance in a separate awaited HTTP request, not the page loader.
    poll();
    const interval = setInterval(poll, 25000);
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
        <s-link href="/app/inventory">월별 재고 보고서</s-link>
        <s-link href="/app/store-label">매장 라벨 인쇄</s-link>
        <s-link href="/app/recipe-blogs">레시피 커머스</s-link>
        <s-link href="/app/app-management">앱 관리</s-link>
        <s-link href="/app/notice">스토어 공지</s-link>
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
