import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/inspect">검수</s-link>
        <s-link href="/app/lieferschein">주문서 출력하기</s-link>
        <s-link href="/app/create-invoice">도매 주문 생성</s-link>
        <s-link href="/app/store-label">매장 에티켓</s-link>
        <s-link href="/app/pick-list">처리중 리스트</s-link>
        <s-link href="/app/inspection-history">검수 내역</s-link>
        <s-link href="/app/returns">반품 검수</s-link>
        <s-link href="/app/container-catalog">컨테이너 카탈로그</s-link>
        <s-link href="/app/recipe-blogs">레시피 블로그</s-link>
        <s-link href="/app/settings">앱 설정</s-link>
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
