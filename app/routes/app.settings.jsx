import { useState } from "react";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Banner,
  Box,
  Divider,
  Tabs,
  Toast,
  Icon,
} from "@shopify/polaris";
import {
  ClipboardIcon,
  CheckIcon,
} from "@shopify/polaris-icons";
import { authenticate, apiVersion } from "../shopify.server";
import { isOdooConfigured } from "../services/odooClient.server.js";
import { isEmailServiceConfigured } from "../utils/emailService.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const appUrl = process.env.SHOPIFY_APP_URL || "https://process-list-beryl.vercel.app";
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const rawSecret = process.env.SHOPIFY_API_SECRET || "";
  const maskedSecret = rawSecret.length > 4 ? `••••••••••••${rawSecret.slice(-4)}` : "미설정";
  const scopes = process.env.SCOPES ? process.env.SCOPES.split(",") : [];
  const shop = session?.shop || "dawayo.de";

  const odooConnected = isOdooConfigured();
  const emailConnected = isEmailServiceConfigured();

  return {
    appUrl,
    apiKey,
    maskedSecret,
    scopes,
    shop,
    apiVersion,
    servicesStatus: {
      shopify: { status: "CONNECTED", label: "연결됨" },
      odoo: {
        status: odooConnected ? "CONNECTED" : "NOT_CONFIGURED",
        label: odooConnected ? "연결됨" : "환경변수 미설정",
      },
      email: {
        status: emailConnected ? "CONNECTED" : "NOT_CONFIGURED",
        label: emailConnected ? "연결됨" : "환경변수 미설정",
      },
      db: { status: "CONNECTED", label: "PostgreSQL 연결됨" },
    },
    endpoints: {
      containerApi: `${appUrl}/api/container`,
      inspectionHistoryApi: `${appUrl}/api/inspection-history`,
      backInStockSubscribeApi: `${appUrl}/api/back-in-stock/subscribe`,
      storefrontNoticeApi: `${appUrl}/api/storefront-notice`,
      printLieferscheinApi: `${appUrl}/print/lieferschein/{order_id}?shop=${shop}&tokens={signed_token}`,
      webhookUninstalled: `${appUrl}/webhooks/app/uninstalled`,
      webhookScopesUpdate: `${appUrl}/webhooks/app/scopes_update`,
      webhookInventoryUpdate: `${appUrl}/webhooks/inventory/update`,
    },
  };
};

export default function Settings() {
  const {
    appUrl,
    apiKey,
    maskedSecret,
    scopes,
    shop,
    apiVersion: currentApiVersion,
    servicesStatus,
    endpoints,
  } = useLoaderData();

  const [selectedTab, setSelectedTab] = useState(0);
  const [copiedField, setCopiedField] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setToastMessage(`${label} 클립보드에 복사되었습니다.`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const codeTabs = [
    { id: "inspection-api", content: "검수 내역 API (/api/inspection-history)" },
    { id: "container-api", content: "컨테이너 연동 API (/api/container)" },
    { id: "back-in-stock-api", content: "재입고 신청 API (/api/back-in-stock/subscribe)" },
    { id: "storefront-notice-api", content: "공지 팝업 API (/api/storefront-notice)" },
    { id: "print-api", content: "납품서 외부 출력 규격" },
  ];

  const curlInspectionExample = `// 1. 검수 내역 목록 및 검색 조회 (GET)
curl -X GET "${endpoints.inspectionHistoryApi}?query=%231001&status=SUCCESS&limit=20" \\
  -H "X-Shop-Domain: ${shop}"

// 2. 검수 내역 저장 및 업서트 (POST)
curl -X POST "${endpoints.inspectionHistoryApi}" \\
  -H "Content-Type: application/json" \\
  -H "X-Shop-Domain: ${shop}" \\
  -d '{
    "orderId": "gid://shopify/Order/12345",
    "orderName": "#1001",
    "shop": "${shop}",
    "inspectorName": "홍길동",
    "status": "SUCCESS",
    "items": [
      {
        "variantId": "gid://shopify/ProductVariant/67890",
        "productTitle": "샘플 상품",
        "sku": "SKU-1001",
        "orderedQuantity": 5,
        "inspectedQuantity": 5
      }
    ]
  }'`;

  const curlContainerExample = `// 1. 컨테이너 및 발주 일정 조회 (GET)
curl -X GET "${endpoints.containerApi}?shop=${shop}"

// 2. Odoo 컨테이너 데이터 자동 동기화 (POST)
curl -X POST "${endpoints.containerApi}" \\
  -H "Content-Type: application/json" \\
  -H "X-Shop-Domain: ${shop}" \\
  -d '{
    "containerRef": "PO00412",
    "actionType": "sync",
    "shop": "${shop}"
  }'`;

  const curlBackInStockExample = `// 1. 재입고 ETA 및 대기자 현황 조회 (GET)
curl -X GET "${endpoints.backInStockSubscribeApi}?variantId=456789&sku=SKU-1001&shop=${shop}"

// 2. 고객 재입고 알림 신청 등록 (POST)
curl -X POST "${endpoints.backInStockSubscribeApi}" \\
  -H "Content-Type: application/json" \\
  -H "X-Shop-Domain: ${shop}" \\
  -d '{
    "shop": "${shop}",
    "variantId": "456789",
    "productTitle": "배추김치 1kg",
    "email": "customer@example.com",
    "channel": "EMAIL"
  }'`;

  const curlNoticeExample = `// 스토어프론트 공지 팝업 설정 조회 (GET)
curl -X GET "${endpoints.storefrontNoticeApi}?shop=${shop}"`;

  const printTokenGuide = `// Node.js crypto HMAC 기반 서명 생성 예시 (만료시간 포함)
const crypto = require("crypto");

function generatePrintToken(orderId, shop, expiresInHours = 48) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const cleanOrderId = orderId.toString().split("/").pop();
  const cleanShop = shop.toLowerCase().trim();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(\`\${cleanOrderId}:\${cleanShop}:\${expiresAt}\`)
    .digest("hex");

  return \`\${expiresAt}.\${signature}\`;
}

// 출력 URL 예시:
// ${appUrl}/print/lieferschein/12345?shop=${shop}&tokens=\${token}`;

  return (
    <Page title="시스템 연동 및 환경 설정">
      <BlockStack gap="500">
        {/* 시스템 안내 배너 */}
        <Banner tone="info">
          Shopify Admin GraphQL, Odoo ERP, Brevo Email 및 외부 물류 시스템 간의 연동 규격과 연결 상태를 확인하고 관리합니다.
        </Banner>

        <Layout>
          {/* 1. 서비스 연결 상태 카드 */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  핵심 서비스 연동 현황
                </Text>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "16px",
                  }}
                >
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">
                        Shopify Admin API
                      </Text>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="bold">
                          {currentApiVersion}
                        </Text>
                        <Badge tone="success">{servicesStatus.shopify.label}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </Box>

                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">
                        Odoo ERP (JSON-RPC)
                      </Text>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="bold">
                          ETA & 위치
                        </Text>
                        <Badge tone={servicesStatus.odoo.status === "CONNECTED" ? "success" : "attention"}>
                          {servicesStatus.odoo.label}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                  </Box>

                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">
                        Brevo 이메일 엔진
                      </Text>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="bold">
                          HTTP v3
                        </Text>
                        <Badge tone={servicesStatus.email.status === "CONNECTED" ? "success" : "attention"}>
                          {servicesStatus.email.label}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                  </Box>

                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">
                        데이터베이스
                      </Text>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="bold">
                          Prisma ORM
                        </Text>
                        <Badge tone="success">{servicesStatus.db.label}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* 2. 기본 인증 정보 */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  애플리케이션 인증 정보
                </Text>
                <Divider />

                <TextField
                  label="스토어 도메인"
                  value={shop}
                  readOnly
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => handleCopy(shop, "스토어 도메인")}>복사</Button>
                  }
                />

                <TextField
                  label="Shopify API Key (Client ID)"
                  value={apiKey}
                  readOnly
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => handleCopy(apiKey, "API Key")}>복사</Button>
                  }
                />

                <TextField
                  label="API Secret Key (보안 마스킹)"
                  value={maskedSecret}
                  readOnly
                  autoComplete="off"
                  helpText="보안을 위해 실제 API Secret은 서버 환경변수에서만 관리되며 클라이언트에 노출되지 않습니다."
                />

                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">
                    부여된 API 권한 범위 (Scopes)
                  </Text>
                  <InlineStack gap="150" wrap>
                    {scopes.map((scope, idx) => (
                      <Badge key={idx} tone="info">
                        {scope}
                      </Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* 3. 웹훅 및 엔드포인트 URL */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  등록 엔드포인트 및 웹훅 URL
                </Text>
                <Divider />

                <TextField
                  label="App Base URL"
                  value={appUrl}
                  readOnly
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => handleCopy(appUrl, "App Base URL")}>복사</Button>
                  }
                />

                <TextField
                  label="재고 변경 웹훅 (inventory_levels/update)"
                  value={endpoints.webhookInventoryUpdate}
                  readOnly
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => handleCopy(endpoints.webhookInventoryUpdate, "재고 웹훅 URL")}>
                      복사
                    </Button>
                  }
                />

                <TextField
                  label="앱 삭제 웹훅 (app/uninstalled)"
                  value={endpoints.webhookUninstalled}
                  readOnly
                  autoComplete="off"
                  connectedRight={
                    <Button onClick={() => handleCopy(endpoints.webhookUninstalled, "앱 삭제 웹훅 URL")}>
                      복사
                    </Button>
                  }
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* 4. 외부 연동 개발자 가이드 및 cURL 예시 */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  외부 시스템 연동 API 가이드
                </Text>
                <Text variant="bodySm" tone="subdued">
                  모바일 바코드 앱 또는 외부 물류 시스템에서 호출할 수 있는 표준 API 규격입니다.
                </Text>

                <Tabs tabs={codeTabs} selected={selectedTab} onSelect={setSelectedTab} />

                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="bodySm" fontWeight="bold">
                        {codeTabs[selectedTab].content}
                      </Text>
                      <Button
                        size="slim"
                        icon={copiedField === codeTabs[selectedTab].id ? CheckIcon : ClipboardIcon}
                        onClick={() => {
                          let snippet = "";
                          if (selectedTab === 0) snippet = curlInspectionExample;
                          else if (selectedTab === 1) snippet = curlContainerExample;
                          else if (selectedTab === 2) snippet = curlBackInStockExample;
                          else if (selectedTab === 3) snippet = curlNoticeExample;
                          else snippet = printTokenGuide;
                          handleCopy(snippet, codeTabs[selectedTab].id);
                        }}
                      >
                        코드 복사
                      </Button>
                    </InlineStack>

                    <pre
                      style={{
                        margin: 0,
                        padding: "12px",
                        backgroundColor: "#0f172a",
                        color: "#f8fafc",
                        borderRadius: "6px",
                        overflowX: "auto",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        lineHeight: 1.5,
                      }}
                    >
                      {selectedTab === 0 && curlInspectionExample}
                      {selectedTab === 1 && curlContainerExample}
                      {selectedTab === 2 && curlBackInStockExample}
                      {selectedTab === 3 && curlNoticeExample}
                      {selectedTab === 4 && printTokenGuide}
                    </pre>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {toastMessage && (
          <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />
        )}
      </BlockStack>
    </Page>
  );
}
