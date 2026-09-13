import MobileConnectionCard from "../components/settings/MobileConnectionCard";
import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
import { isEmailServiceConfigured, sendCancellationAlertEmail } from "../utils/emailService.js";
import { getRegisteredWebhooks, ensureRequiredWebhooks } from "../services/webhookRegistration.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const appUrl = process.env.SHOPIFY_APP_URL || "https://process-list-beryl.vercel.app";
  const registeredWebhooks = await getRegisteredWebhooks(admin);
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const rawSecret = process.env.SHOPIFY_API_SECRET || "";
  const maskedSecret = rawSecret.length > 4 ? `••••••••••••${rawSecret.slice(-4)}` : "미설정";
  const scopes = process.env.SCOPES ? process.env.SCOPES.split(",") : [];
  const shop = session?.shop || "dawayo.de";

  const odooConnected = isOdooConfigured();
  const emailConnected = isEmailServiceConfigured();

  return {
    appUrl,
    mobileConnection: {
      baseUrl: new URL(appUrl).origin,
      configured: process.env.CUSTOMER_API_SHOP === shop && Boolean(process.env.CUSTOMER_ACCOUNT_API_URL),
      nativeOriginsReady: ['capacitor://localhost', 'https://localhost'].every(origin => (process.env.CUSTOMER_API_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)),
    },
    apiKey,
    maskedSecret,
    scopes,
    shop,
    apiVersion,
    registeredWebhooks,
    servicesStatus: {
      shopify: { status: "CONNECTED", label: "연결됨" },
      odoo: {
        status: odooConnected ? "CONNECTED" : "NOT_CONFIGURED",
        label: odooConnected ? "연결됨" : "환경변수 미설정",
      },
      email: {
        status: emailConnected ? "CONNECTED" : "NOT_CONFIGURED",
        label: emailConnected ? "연결됨" : "환경변수 미설정",
        senderEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "미설정",
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

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const appUrl = process.env.SHOPIFY_APP_URL || "https://process-list-beryl.vercel.app";

  if (intent === "force_register_webhooks") {
    try {
      const results = await ensureRequiredWebhooks(admin, appUrl);
      const webhooks = await getRegisteredWebhooks(admin);
      return {
        success: true,
        webhookResults: results,
        registeredWebhooks: webhooks,
        message: "웹훅(ORDERS_CANCELLED, ORDERS_UPDATED)이 쇼피파이 스토어에 성공적으로 등록되었습니다.",
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (intent === "test_send_cancel_email") {
    const rawNum = String(formData.get("orderNumber") || "18071").trim();
    const cleanNum = rawNum.replace(/^#/, "");

    try {
      const orderRes = await admin.graphql(
        `#graphql
        query getOrderForTest($query: String!) {
          orders(first: 1, query: $query) {
            edges {
              node {
                id
                name
                email
                cancelledAt
                cancelReason
                totalPriceSet { shopMoney { amount currencyCode } }
                shippingAddress { name }
                billingAddress { name }
                lineItems(first: 50) {
                  edges {
                    node {
                      title
                      quantity
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { query: `name:#${cleanNum} OR name:${cleanNum}` } }
      );

      const orderJson = await orderRes.json();
      const orderNode = orderJson.data?.orders?.edges?.[0]?.node;

      const orderName = orderNode?.name || `#${cleanNum}`;
      const customerEmail = orderNode?.email || "customer@dawayo.de";
      const customerName = orderNode?.shippingAddress?.name || orderNode?.billingAddress?.name || "고객";
      const cancelReason = orderNode?.cancelReason || "EU 청약철회(Widerruf) / 고객 취소 요청";
      const cancelledAt = orderNode?.cancelledAt ? new Date(orderNode.cancelledAt) : new Date();
      const totalAmount = orderNode?.totalPriceSet?.shopMoney?.amount || "0.00";
      const currency = orderNode?.totalPriceSet?.shopMoney?.currencyCode || "EUR";
      const items = (orderNode?.lineItems?.edges || []).map((e) => ({
        title: e.node.title,
        quantity: e.node.quantity,
      }));

      const sendResults = await sendCancellationAlertEmail({
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt,
        totalAmount,
        currency,
        items: items.length > 0 ? items : [{ title: "테스트 주문 상품", quantity: 1 }],
        shopDomain: session.shop,
      });

      const messageIds = (sendResults || []).map((r) => r.value?.messageId || "성공").join(", ");

      return {
        success: true,
        message: `${orderName} 주문 알림 메일이 service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de 로 정상 발송되었습니다. (Brevo ID: ${messageIds})`,
      };
    } catch (err) {
      console.error("Test email send error:", err);
      return { success: false, error: err.message };
    }
  }

  return null;
};

export default function Settings() {
  const {
    mobileConnection,
    appUrl,
    apiKey,
    maskedSecret,
    scopes,
    shop,
    apiVersion: currentApiVersion,
    servicesStatus,
    endpoints,
    registeredWebhooks = [],
  } = useLoaderData();

  const [selectedTab, setSelectedTab] = useState(0);
  const [copiedField, setCopiedField] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [testOrderNumber, setTestOrderNumber] = useState("18071");

  const testFetcher = useFetcher();
  const webhookFetcher = useFetcher();

  const handleRegisterWebhooks = () => {
    webhookFetcher.submit({ intent: "force_register_webhooks" }, { method: "POST" });
  };

  const handleSendTestEmail = () => {
    testFetcher.submit(
      { intent: "test_send_cancel_email", orderNumber: testOrderNumber },
      { method: "POST" }
    );
  };

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setToastMessage(`${label} 클립보드에 복사되었습니다.`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const codeTabs = [
    { id: "inspection-api", content: "직원용 검수 API (/api/inspection-history)" },
    { id: "container-api", content: "직원용 컨테이너 API (/api/container)" },
    { id: "back-in-stock-api", content: "재입고 신청 API (/api/back-in-stock/subscribe)" },
    { id: "storefront-notice-api", content: "공지 팝업 API (/api/storefront-notice)" },
    { id: "print-api", content: "납품서 외부 출력 규격" },
  ];

  const curlInspectionExample = `// 1. 검수 내역 목록 및 검색 조회 (GET)
curl -X GET "${endpoints.inspectionHistoryApi}?query=%231001&status=SUCCESS&limit=20" \\
  -H "Authorization: Bearer <integration-token>"

// 2. 검수 내역 저장 및 업서트 (POST)
curl -X POST "${endpoints.inspectionHistoryApi}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <integration-token>" \\
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
curl -X GET "${endpoints.containerApi}" -H "Authorization: Bearer <integration-token>"

// 2. Odoo 컨테이너 데이터 자동 동기화 (POST)
curl -X POST "${endpoints.containerApi}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <integration-token>" \\
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
          <Layout.Section><MobileConnectionCard {...mobileConnection} /></Layout.Section>
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

                <Divider />

                {/* 이메일 발송 테스트 박스 */}
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3" fontWeight="bold">
                      취소 / EU 청약철회 알림 메일 테스트 발송
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      주문번호를 입력하여 service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de 로 알림 메일을 즉시 테스트 발송합니다.
                    </Text>
                    <InlineStack gap="300" wrap>
                      <Text variant="bodySm" tone="subdued">
                        발신 계정: <strong>{servicesStatus.email.senderEmail}</strong>
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        상태: <strong>{servicesStatus.email.label}</strong>
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="주문번호"
                          labelHidden
                          value={testOrderNumber}
                          onChange={setTestOrderNumber}
                          placeholder="예: 18071"
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        variant="primary"
                        tone="critical"
                        loading={testFetcher.state === "submitting"}
                        onClick={handleSendTestEmail}
                      >
                        테스트 메일 발송
                      </Button>
                    </InlineStack>
                    {testFetcher.data?.message && (
                      <Banner tone="success">{testFetcher.data.message}</Banner>
                    )}
                    {testFetcher.data?.error && (
                      <Banner tone="critical">
                        <p><strong>발송 실패:</strong> {testFetcher.data.error}</p>
                      </Banner>
                    )}
                  </BlockStack>
                </Box>

                <Divider />

                {/* 웹훅 등록 상태 확인 */}
                <Box paddingBlockStart="300">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <div>
                        <Text variant="headingSm" as="h3" fontWeight="bold">
                          실시간 웹훅(Webhook) 등록 상태
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          고객 취소/청약철회 요청 시 실시간 신호를 수신하는 웹훅입니다.
                        </Text>
                      </div>
                      <Button
                        size="slim"
                        loading={webhookFetcher.state === "submitting"}
                        onClick={handleRegisterWebhooks}
                      >
                        웹훅 상태 새로고침 / 강제 등록
                      </Button>
                    </InlineStack>

                    {webhookFetcher.data?.message && (
                      <Banner tone="success">{webhookFetcher.data.message}</Banner>
                    )}

                    <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      <Text variant="bodySm" fontWeight="bold">현재 쇼피파이에 등록된 실시간 웹훅:</Text>
                      {registeredWebhooks.length > 0 ? (
                        <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "13px" }}>
                          {registeredWebhooks.map((w, idx) => (
                            <li key={idx} style={{ marginBottom: "4px" }}>
                              <strong>{w.topic}</strong> &rarr; {w.callbackUrl}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Text variant="bodySm" tone="critical">등록된 웹훅이 없습니다. 위 [웹훅 강제 등록] 버튼을 눌러주세요.</Text>
                      )}
                    </div>
                  </BlockStack>
                </Box>
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
