import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router"; // (Remix 버전에 따라 @remix-run/react 일 수도 있습니다)
import {
  Page,
  Layout,
  Card,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Badge,
  Thumbnail,
  Button,
  Banner,
  Box,
  EmptyState,
  Icon,      // ✨ 추가: 아이콘 렌더링을 위한 컴포넌트
  Divider,   // ✨ 추가: 하단에서 사용된 구분선 컴포넌트
} from "@shopify/polaris";

// ✨ 수정: Minor, Major 접미사가 제거된 최신 아이콘 이름 사용
import { SearchIcon, BarcodeIcon } from "@shopify/polaris-icons"; 
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_order") {
    const orderName = formData.get("orderName");
    const response = await admin.graphql(
      `#graphql
      query findOrder($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    variantTitle
                    sku
                    quantity
                    variant {
                      id
                      barcode
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: { query: `name:${orderName}` },
      }
    );

    const json = await response.json();
    const order = json.data?.orders?.edges[0]?.node;

    if (!order) {
      return { error: "주문을 찾을 수 없습니다." };
    }

    const items = order.lineItems.edges.map(edge => ({
      id: edge.node.id,
      variantId: edge.node.variant?.id,
      title: edge.node.title,
      variantTitle: edge.node.variantTitle,
      sku: edge.node.sku,
      barcode: edge.node.variant?.barcode,
      imageUrl: edge.node.variant?.image?.url,
      orderedQuantity: edge.node.quantity,
      inspectedQuantity: 0,
    }));

    return { order: { id: order.id, name: order.name, items } };
  }

  if (intent === "save_inspection") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName");
    const items = JSON.parse(formData.get("items"));
    
    const isSuccess = items.every(item => item.inspectedQuantity === item.orderedQuantity);
    const status = isSuccess ? "SUCCESS" : "PARTIAL";

    const record = await prisma.inspectionRecord.create({
      data: {
        orderId,
        orderName,
        shop: session.shop,
        status,
        completedAt: new Date(),
        items: {
          create: items.map(item => ({
            variantId: item.variantId || "N/A",
            productTitle: item.title,
            variantTitle: item.variantTitle,
            sku: item.sku,
            barcode: item.barcode,
            orderedQuantity: item.orderedQuantity,
            inspectedQuantity: item.inspectedQuantity,
          })),
        },
      },
    });

    return { success: true, recordId: record.id };
  }

  return null;
};

export default function Inspect() {
  const fetcher = useFetcher();
  const saveFetcher = useFetcher();
  const [orderName, setOrderName] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState(null);
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (fetcher.data?.order) {
      setCurrentOrder(fetcher.data.order);
      setBarcode("");
      setMessage({ type: "success", text: `${fetcher.data.order.name} 주문을 불러왔습니다.` });
      setTimeout(() => barcodeRef.current?.focus(), 100);
    } else if (fetcher.data?.error) {
      setMessage({ type: "error", text: fetcher.data.error });
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (saveFetcher.data?.success) {
      setMessage({ type: "success", text: "검수 결과가 성공적으로 저장되었습니다." });
      setCurrentOrder(null);
      setOrderName("");
    }
  }, [saveFetcher.data]);

  const handleSearch = () => {
    fetcher.submit({ intent: "fetch_order", orderName }, { method: "POST" });
  };

  const handleBarcodeScan = (e) => {
    if (e.key === "Enter") {
      processBarcode(barcode);
    }
  };

  const processBarcode = (scannedBarcode) => {
    if (!currentOrder) return;

    const itemIndex = currentOrder.items.findIndex(
      item => item.barcode === scannedBarcode || item.sku === scannedBarcode
    );

    if (itemIndex > -1) {
      const updatedItems = [...currentOrder.items];
      const item = updatedItems[itemIndex];

      if (item.inspectedQuantity < item.orderedQuantity) {
        item.inspectedQuantity += 1;
        setCurrentOrder({ ...currentOrder, items: updatedItems });
        setMessage({ type: "success", text: `[${item.title}] 검수 완료 (${item.inspectedQuantity}/${item.orderedQuantity})` });
      } else {
        setMessage({ type: "warning", text: `[${item.title}] 이미 모든 수량이 검수되었습니다.` });
      }
    } else {
      setMessage({ type: "error", text: "주문에 포함되지 않은 바코드입니다!" });
    }
    setBarcode("");
  };

  const handleSave = () => {
    saveFetcher.submit(
      {
        intent: "save_inspection",
        orderId: currentOrder.id,
        orderName: currentOrder.name,
        items: JSON.stringify(currentOrder.items),
      },
      { method: "POST" }
    );
  };

  const rows = currentOrder?.items.map(item => [
    <Thumbnail source={item.imageUrl || ""} alt={item.title} size="small" />,
    <BlockStack>
      <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
      <Text variant="bodySm" color="subdued">{item.variantTitle}</Text>
      <Text variant="bodySm" color="subdued">SKU: {item.sku || "N/A"}</Text>
    </BlockStack>,
    item.barcode || "N/A",
    `${item.inspectedQuantity} / ${item.orderedQuantity}`,
    <Badge tone={item.inspectedQuantity === item.orderedQuantity ? "success" : "attention"}>
      {item.inspectedQuantity === item.orderedQuantity ? "완료" : "대기"}
    </Badge>
  ]) || [];

  return (
    <Page title="주문 검수 (Scan-to-Verify)" backAction={{ content: "대시보드", url: "/app" }}>
      <Layout>
        {/* 검색 및 메시지 영역 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                <Box grow>
                  <TextField
                    label="주문 번호 검색 (예: #1001)"
                    value={orderName}
                    onChange={setOrderName}
                    autoComplete="off"
                    // ✨ 수정: Icon 컴포넌트로 감싸서 렌더링
                    prefix={<Icon source={SearchIcon} />} 
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </Box>
                <Box paddingBlockStart="500">
                  <Button onClick={handleSearch} loading={fetcher.state === "submitting"}>불러오기</Button>
                </Box>
              </InlineStack>

              {message && (
                <Banner tone={message.type === "error" ? "critical" : message.type} onDismiss={() => setMessage(null)}>
                  <p>{message.text}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 검수 진행 영역 */}
        <Layout.Section>
          {currentOrder ? (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">{currentOrder.name} 검수 리스트</Text>
                  <TextField
                    label="상품 바코드 스캔"
                    value={barcode}
                    onChange={setBarcode}
                    autoComplete="off"
                    // ✨ 수정: Icon 컴포넌트로 감싸서 렌더링
                    prefix={<Icon source={BarcodeIcon} />} 
                    onKeyDown={handleBarcodeScan}
                    ref={barcodeRef}
                    helpText="상품의 바코드를 스캔하거나 SKU를 입력하고 Enter를 누르세요."
                  />
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                    headings={['이미지', '상품명', '바코드', '수량', '상태']}
                    rows={rows}
                  />
                  <Divider />
                  <InlineStack align="end">
                    <Button onClick={() => setCurrentOrder(null)}>취소</Button>
                    <Button primary onClick={handleSave} loading={saveFetcher.state === "submitting"}>
                      검수 완료 및 저장
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          ) : (
            <Card>
              <EmptyState
                heading="검수할 주문을 불러오세요"
                action={{ content: '주문 검색하기', onAction: () => document.querySelector('input')?.focus() }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>주문 번호를 입력하여 상품 검수를 시작할 수 있습니다.</p>
              </EmptyState>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}