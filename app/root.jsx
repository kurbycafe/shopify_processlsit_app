import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useLocation, useRouteError } from "react-router";

import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import koTranslations from "@shopify/polaris/locales/ko.json";

export default function App() {
  // Staff screens are Korean; the customer invoice page is German.
  const lang = useLocation().pathname.startsWith("/customer-invoice") ? "de" : "ko";
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>

      <body>

        <AppProvider i18n={koTranslations}>
          <Outlet />
        </AppProvider>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Last-resort screen for errors no route handled, shown instead of React Router's bare default.
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const notFound = status === 404;
  if (!isRouteErrorResponse(error)) console.error(error);

  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{notFound ? "페이지를 찾을 수 없습니다" : "오류가 발생했습니다"}</title>
        <Meta />
        <Links />
      </head>
      <body style={{ margin: 0, fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif", background: "#f1f1f1", color: "#303030" }}>
        <main style={{ maxWidth: 480, margin: "15vh auto", padding: "32px 24px", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.12)", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#616161" }}>{status}</p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 20 }}>{notFound ? "페이지를 찾을 수 없습니다" : "일시적인 오류가 발생했습니다"}</h1>
          <p style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.5 }}>
            {notFound ? "주소를 확인하거나 메뉴에서 다시 이동해 주세요." : "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요."}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 16px", fontSize: 14, border: 0, borderRadius: 8, background: "#303030", color: "#fff", cursor: "pointer" }}>
            다시 시도
          </button>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
