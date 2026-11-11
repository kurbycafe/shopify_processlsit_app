import { isRouteErrorResponse, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Banner, BlockStack, Button, InlineStack, Page, Text } from "@shopify/polaris";

// Shown inside the admin shell when one screen fails, so the menu stays usable
// and staff can retry instead of losing the whole app to an error page.
export function RouteErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();

  // Shopify auth redirects and other thrown responses must keep their headers.
  if (isRouteErrorResponse(error) || error instanceof Response) return boundary.error(error);

  console.error("[Admin screen error]", error);
  return (
    <Page title="화면을 불러오지 못했습니다" backAction={{ content: "대시보드", url: "/app" }}>
      <Banner tone="critical" title="일시적인 오류가 발생했습니다">
        <BlockStack gap="300">
          <Text as="p">
            Shopify 또는 Odoo 연결이 잠시 불안정했을 수 있습니다. 다시 시도해도 계속되면 관리자에게 알려 주세요.
          </Text>
          <InlineStack gap="200">
            <Button variant="primary" loading={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
              다시 시도
            </Button>
            <Button onClick={() => window.location.reload()}>페이지 새로고침</Button>
          </InlineStack>
        </BlockStack>
      </Banner>
    </Page>
  );
}
