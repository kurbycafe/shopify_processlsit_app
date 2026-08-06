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
  ViewIcon,
  HideIcon,
  KeyIcon,
  LinkIcon,
  CodeIcon,
  CheckIcon,
} from "@shopify/polaris-icons";
import { authenticate, apiVersion } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const appUrl = process.env.SHOPIFY_APP_URL || "https://process-list-beryl.vercel.app";
  const apiKey = process.env.SHOPIFY_API_KEY || "24143f6f7f7be925cb7037a74f9915b2";
  const apiSecretKey = process.env.SHOPIFY_API_SECRET || "";
  const scopes = process.env.SCOPES ? process.env.SCOPES.split(",") : [];
  const shop = session?.shop || "";

  return {
    appUrl,
    apiKey,
    apiSecretKey,
    scopes,
    shop,
    apiVersion,
    endpoints: {
      containerApi: `${appUrl}/api/container`,
      inspectionHistoryApi: `${appUrl}/api/inspection-history`,
      printLieferscheinApi: `${appUrl}/print/lieferschein/{order_id}?token={print_token}`,
      webhookUninstalled: `${appUrl}/webhooks/app/uninstalled`,
      webhookScopesUpdate: `${appUrl}/webhooks/app/scopes_update`,
    },
  };
};

export default function Settings() {
  const {
    appUrl,
    apiKey,
    apiSecretKey,
    scopes,
    shop,
    apiVersion: currentApiVersion,
    endpoints,
  } = useLoaderData();

  const [showSecret, setShowSecret] = useState(false);
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
    { id: "inspection-api", content: "GET/POST /api/inspection-history (검수 내역)" },
    { id: "container-api", content: "POST /api/container (컨테이너 연동)" },
    { id: "print-api", content: "GET /print/lieferschein (납품서 출력)" },
  ];

  const curlInspectionExample = `// 1. 검수 내역 목록 및 검색 조회 (GET)
curl -X GET "${endpoints.inspectionHistoryApi}?query=%231001&status=SUCCESS&limit=20"

// 2. 검수 내역 저장 및 업서트 (POST)
curl -X POST "${endpoints.inspectionHistoryApi}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "orderId": "gid://shopify/Order/12345",
    "orderName": "#1001",
    "shop": "${shop || "your-shop.myshopify.com"}",
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

  const jsInspectionExample = `// 검수 내역 조회 (GET)
fetch("${endpoints.inspectionHistoryApi}?status=ALL&limit=50")
  .then(res => res.json())
  .then(data => console.log("검수 기록 목록:", data.records));`;

  const curlContainerExample = `curl -X POST "${endpoints.containerApi}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "containerId": "CONT-2026-001",
    "status": "ARRIVED",
    "items": [
      { "sku": "SKU-1001", "quantity": 50 }
    ]
  }'`;

  const jsContainerExample = `fetch("${endpoints.containerApi}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    containerId: "CONT-2026-001",
    status: "ARRIVED",
    items: [
      { sku: "SKU-1001", quantity: 50 }
    ]
  })
})
.then(res => res.json())
.then(data => console.log("응답 결과:", data));`;

  const printTokenGuide = `// Node.js crypto 예시 (Token 생성 규격)
const crypto = require("crypto");

function generatePrintToken(orderId, shop, apiSecret) {
  const cleanOrderId = orderId.toString().split("/").pop();
  return crypto
    .createHmac("sha256", apiSecret)
    .update(\`\${cleanOrderId}:\${shop}\`)
    .digest("hex");
}

// 호출 URL 예시:
// ${appUrl}/print/lieferschein/1001?token=GENERATED_HMAC_TOKEN&shop=${shop || "your-shop.myshopify.com"}`;

  return (
    <Page
      title="앱 설정 (App Settings)"
      subtitle="API 요청 URL, 인증 키, 웹훅 엔드포인트 및 외부 연동 정보"
    >
      <BlockStack gap="500">
        {/* 설명 배너 */}
        <Banner title="외부 모바일 앱 및 API 연동 가이드" status="info">
          <p>
            외부 앱(모바일 검수 앱 등) 및 커스텀 서비스에서 본 Shopify 앱으로 데이터를 요청할 때 필요한 
            <strong> API Endpoints, API Key, Secret Key</strong> 정보를 확인하고 테스트할 수 있습니다.
          </p>
        </Banner>

        <Layout>
          {/* 좌측: API 인증 정보 & 상점 설정 */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      API 인증 키 (Credentials)
                    </Text>
                    <Icon source={KeyIcon} tone="base" />
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="300">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      상점 도메인 (Shop Domain)
                    </Text>
                    <InlineStack align="space-between" blockAlign="center">
                      <Badge tone="info">{shop || "설정 안됨"}</Badge>
                      <Button
                        size="micro"
                        icon={copiedField === "Shop Domain" ? CheckIcon : ClipboardIcon}
                        onClick={() => handleCopy(shop, "Shop Domain")}
                      >
                        복사
                      </Button>
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="200">
                    <TextField
                      label="Shopify Client ID (API Key)"
                      value={apiKey}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={copiedField === "API Key" ? CheckIcon : ClipboardIcon}
                          onClick={() => handleCopy(apiKey, "API Key")}
                        >
                          복사
                        </Button>
                      }
                    />
                  </BlockStack>

                  <BlockStack gap="200">
                    <TextField
                      label="Shopify API Secret Key"
                      type={showSecret ? "text" : "password"}
                      value={apiSecretKey || "미설정 (env 파일 확인 필요)"}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <InlineStack gap="100">
                          <Button
                            icon={showSecret ? HideIcon : ViewIcon}
                            onClick={() => setShowSecret(!showSecret)}
                            accessibilityLabel={showSecret ? "숨기기" : "보기"}
                          >
                            {showSecret ? "숨기기" : "보기"}
                          </Button>
                          <Button
                            icon={copiedField === "API Secret Key" ? CheckIcon : ClipboardIcon}
                            onClick={() => handleCopy(apiSecretKey, "API Secret Key")}
                          >
                            복사
                          </Button>
                        </InlineStack>
                      }
                    />
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      현재 API Version
                    </Text>
                    <Badge tone="success">{currentApiVersion}</Badge>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      부여된 Scope 권한 목록
                    </Text>
                    <InlineStack gap="100" wrap>
                      {scopes.length > 0 ? (
                        scopes.map((scope) => (
                          <Badge key={scope} tone="subdued">
                            {scope}
                          </Badge>
                        ))
                      ) : (
                        <Text tone="subdued">권한 정보 없음</Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* 우측: 엔드포인트 URL 및 코드 예시 */}
          <Layout.Section>
            <BlockStack gap="400">
              {/* 카드: 요청 URL 정보 */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      요청 URL & 엔드포인트 (Request Endpoints)
                    </Text>
                    <Icon source={LinkIcon} tone="base" />
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="300">
                    <TextField
                      label="기본 앱 URL (Base App URL)"
                      value={appUrl}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={copiedField === "Base App URL" ? CheckIcon : ClipboardIcon}
                          onClick={() => handleCopy(appUrl, "Base App URL")}
                        >
                          복사
                        </Button>
                      }
                    />
                  </BlockStack>

                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="bold" as="span">
                        검수 내역 조회/저장 API (Inspection History API)
                      </Text>
                      <Badge tone="success">GET / POST</Badge>
                    </InlineStack>
                    <TextField
                      label=""
                      labelHidden
                      value={endpoints.inspectionHistoryApi}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={copiedField === "Inspection API URL" ? CheckIcon : ClipboardIcon}
                          onClick={() => handleCopy(endpoints.inspectionHistoryApi, "Inspection API URL")}
                        >
                          복사
                        </Button>
                      }
                    />
                    <Text variant="bodySm" tone="subdued">
                      모바일 검수 앱이나 외부 시스템에서 검수 완료 기록을 조회하고 결과를 등록할 수 있습니다.
                    </Text>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="bold" as="span">
                        컨테이너 정보 수신/조회 API (Container API)
                      </Text>
                      <Badge tone="attention">POST / GET</Badge>
                    </InlineStack>
                    <TextField
                      label=""
                      labelHidden
                      value={endpoints.containerApi}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={copiedField === "Container API URL" ? CheckIcon : ClipboardIcon}
                          onClick={() => handleCopy(endpoints.containerApi, "Container API URL")}
                        >
                          복사
                        </Button>
                      }
                    />
                    <Text variant="bodySm" tone="subdued">
                      모바일 앱이나 외부 시스템에서 컨테이너 수량 및 검수 상태를 연동할 때 호출하는 URL입니다.
                    </Text>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="bold" as="span">
                        납품서 (Lieferschein) PDF 출력 API
                      </Text>
                      <Badge tone="success">GET</Badge>
                    </InlineStack>
                    <TextField
                      label=""
                      labelHidden
                      value={endpoints.printLieferscheinApi}
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={copiedField === "Print API URL" ? CheckIcon : ClipboardIcon}
                          onClick={() => handleCopy(endpoints.printLieferscheinApi, "Print API URL")}
                        >
                          복사
                        </Button>
                      }
                    />
                    <Text variant="bodySm" tone="subdued">
                      외부 앱이나 웹 브라우저에서 주문서/납품서를 바로 인쇄할 수 있는 보안 링크입니다 (token 필수).
                    </Text>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                      등록된 웹훅(Webhook) 엔드포인트
                    </Text>
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodySm">app/uninstalled:</Text>
                        <Text variant="bodySm" tone="subdued" fontFamily="monospace">
                          {endpoints.webhookUninstalled}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodySm">app/scopes_update:</Text>
                        <Text variant="bodySm" tone="subdued" fontFamily="monospace">
                          {endpoints.webhookScopesUpdate}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* 카드: 연동 예시 코드 */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      API 연동 가이드 & 코드 예시
                    </Text>
                    <Icon source={CodeIcon} tone="base" />
                  </InlineStack>

                  <Divider />

                  <Tabs tabs={codeTabs} selected={selectedTab} onSelect={setSelectedTab}>
                    <Box paddingBlockStart="300">
                      {selectedTab === 0 && (
                        <BlockStack gap="300">
                          <Text variant="bodyMd" fontWeight="semibold" as="h3">
                            1. cURL 요청 예시 (검수 내역 조회 & 저장)
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <pre style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
                              {curlInspectionExample}
                            </pre>
                          </Box>
                          <InlineStack align="end">
                            <Button
                              size="micro"
                              icon={copiedField === "cURL Inspection Example" ? CheckIcon : ClipboardIcon}
                              onClick={() => handleCopy(curlInspectionExample, "cURL Inspection Example")}
                            >
                              cURL 예시 복사
                            </Button>
                          </InlineStack>

                          <Divider />

                          <Text variant="bodyMd" fontWeight="semibold" as="h3">
                            2. JavaScript Fetch 요청 예시
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <pre style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
                              {jsInspectionExample}
                            </pre>
                          </Box>
                          <InlineStack align="end">
                            <Button
                              size="micro"
                              icon={copiedField === "JS Inspection Example" ? CheckIcon : ClipboardIcon}
                              onClick={() => handleCopy(jsInspectionExample, "JS Inspection Example")}
                            >
                              JS 예시 복사
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {selectedTab === 1 && (
                        <BlockStack gap="300">
                          <Text variant="bodyMd" fontWeight="semibold" as="h3">
                            1. cURL 요청 예시
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <pre style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
                              {curlContainerExample}
                            </pre>
                          </Box>
                          <InlineStack align="end">
                            <Button
                              size="micro"
                              icon={copiedField === "cURL Example" ? CheckIcon : ClipboardIcon}
                              onClick={() => handleCopy(curlContainerExample, "cURL Example")}
                            >
                              cURL 예시 복사
                            </Button>
                          </InlineStack>

                          <Divider />

                          <Text variant="bodyMd" fontWeight="semibold" as="h3">
                            2. JavaScript Fetch 요청 예시
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <pre style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
                              {jsContainerExample}
                            </pre>
                          </Box>
                          <InlineStack align="end">
                            <Button
                              size="micro"
                              icon={copiedField === "JS Fetch Example" ? CheckIcon : ClipboardIcon}
                              onClick={() => handleCopy(jsContainerExample, "JS Fetch Example")}
                            >
                              JS 예시 복사
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}

                      {selectedTab === 2 && (
                        <BlockStack gap="300">
                          <Text variant="bodyMd" fontWeight="semibold" as="h3">
                            납품서 출력 토큰(HMAC SHA-256) 생성 예시
                          </Text>
                          <Text variant="bodySm">
                            출력 페이지 보안을 위해 <code>SHOPIFY_API_SECRET</code>을 키로 사용하여 <code>orderId:shop</code> 규격의 HMAC 토큰을 생성합니다.
                          </Text>
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <pre style={{ margin: 0, fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
                              {printTokenGuide}
                            </pre>
                          </Box>
                          <InlineStack align="end">
                            <Button
                              size="micro"
                              icon={copiedField === "Print Token Guide" ? CheckIcon : ClipboardIcon}
                              onClick={() => handleCopy(printTokenGuide, "Print Token Guide")}
                            >
                              토큰 가이드 복사
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      )}
                    </Box>
                  </Tabs>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* 토스트 알림 */}
        {toastMessage && (
          <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} duration={3000} />
        )}
      </BlockStack>
    </Page>
  );
}
