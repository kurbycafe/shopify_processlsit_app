import { useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
  Divider,
  Icon,
  EmptyState,
  Checkbox
} from "@shopify/polaris";
import { SearchIcon, BarcodeIcon, CalendarIcon, PersonIcon } from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// inspector fallback helper
async function getInspectorName(admin, session) {
  if (session.firstName || session.lastName) {
    return `${session.firstName || ""} ${session.lastName || ""}`.trim();
  }
  try {
    const staffResponse = await admin.graphql(
      `#graphql
      query {
        currentStaffMember {
          firstName
          lastName
        }
      }`
    );
    const staffJson = await staffResponse.json();
    if (staffJson.data?.currentStaffMember) {
      const { firstName, lastName } = staffJson.data.currentStaffMember;
      if (firstName || lastName) {
        return `${firstName || ""} ${lastName || ""}`.trim();
      }
    }
  } catch (e) {}

  try {
    const shopResponse = await admin.graphql(
      `#graphql
      query {
        shop {
          shopOwner
        }
      }`
    );
    const shopJson = await shopResponse.json();
    if (shopJson.data?.shop?.shopOwner) {
      return shopJson.data.shop.shopOwner;
    }
  } catch (e) {}

  return "알 수 없음";
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const inspectorName = await getInspectorName(admin, session);

  // 과거 반품 내역 조회 (최근 15건)
  const returnHistory = await prisma.returnRecord.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { items: true }
  });

  return { inspectorName, returnHistory };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_order") {
    const orderName = formData.get("orderName");
    const cleanQuery = orderName.trim().replace(/^#/, "");
    const queryStr = `name:${cleanQuery} OR name:#${cleanQuery} OR tracking_number:${orderName.trim()}`;

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
                      image { url }
                      product {
                        featuredImage { url }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { query: queryStr } }
    );

    const json = await response.json();
    const order = json.data?.orders?.edges[0]?.node;

    if (!order) return { error: "주문을 찾을 수 없습니다." };

    const items = order.lineItems.edges.map(edge => ({
      id: edge.node.id,
      title: edge.node.title,
      variantTitle: edge.node.variantTitle || "",
      sku: edge.node.sku || "",
      barcode: edge.node.variant?.barcode || "",
      imageUrl: edge.node.variant?.image?.url || edge.node.variant?.product?.featuredImage?.url || "",
      orderedQuantity: edge.node.quantity,
      returnedQuantity: 0,
    }));

    return { order: { id: order.id, name: order.name, items } };
  }

  if (intent === "save_return") {
    const orderName = formData.get("orderName");
    const isDamaged = formData.get("isDamaged") === "true";
    const damageReason = formData.get("damageReason") || "";
    const isProcessed = formData.get("isProcessed") === "true";
    const inspectorName = formData.get("inspectorName") || "";
    const returnedAtStr = formData.get("returnedAt");
    const items = JSON.parse(formData.get("items") || "[]");

    const returnedAt = returnedAtStr ? new Date(returnedAtStr) : new Date();

    const record = await prisma.returnRecord.create({
      data: {
        orderName,
        returnedAt,
        isDamaged,
        damageReason,
        isProcessed,
        inspectorName,
        shop,
        items: {
          create: items.map(item => ({
            productTitle: item.title,
            variantTitle: item.variantTitle,
            sku: item.sku,
            barcode: item.barcode,
            quantity: item.returnedQuantity
          }))
        }
      }
    });

    return { success: true, recordId: record.id };
  }

  return null;
};

export default function ReturnsPage() {
  const { inspectorName, returnHistory } = useLoaderData();
  const fetcher = useFetcher();
  const saveFetcher = useFetcher();

  const [orderName, setOrderName] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [returnedAt, setReturnedAt] = useState(dayjs().format("YYYY-MM-DD"));
  const [isDamaged, setIsDamaged] = useState(false);
  const [damageReason, setDamageReason] = useState("");
  const [isProcessed, setIsProcessed] = useState(false);
  const [message, setMessage] = useState(null);
  
  const barcodeRef = useRef(null);

  // Audio feedback helper
  const playSound = (type) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === "success") {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "warning") {
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } else if (type === "error") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (fetcher.data?.order) {
      setCurrentOrder(fetcher.data.order);
      setBarcode("");
      setMessage({ type: "success", text: `${fetcher.data.order.name} 주문정보를 불러왔습니다. 반품된 바코드를 스캔해 주세요.` });
      playSound("success");
      setTimeout(() => barcodeRef.current?.focus(), 150);
    } else if (fetcher.data?.error) {
      setMessage({ type: "error", text: fetcher.data.error });
      playSound("error");
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (saveFetcher.data?.success) {
      setMessage({ type: "success", text: "반품 검수 결과가 성공적으로 데이터베이스에 기록되었습니다." });
      setCurrentOrder(null);
      setOrderName("");
      setIsDamaged(false);
      setDamageReason("");
      setIsProcessed(false);
      playSound("success");
    }
  }, [saveFetcher.data]);

  const handleOrderSearch = () => {
    if (!orderName.trim()) return;
    fetcher.submit({ intent: "fetch_order", orderName }, { method: "POST" });
  };

  const processBarcode = (scannedBarcode) => {
    if (!currentOrder || !scannedBarcode.trim()) return;

    const itemIndex = currentOrder.items.findIndex(
      item => item.barcode === scannedBarcode || item.sku === scannedBarcode
    );

    if (itemIndex > -1) {
      const updatedItems = [...currentOrder.items];
      const item = updatedItems[itemIndex];

      if (item.returnedQuantity < item.orderedQuantity) {
        item.returnedQuantity += 1;
        setCurrentOrder({ ...currentOrder, items: updatedItems });
        setMessage({ type: "success", text: `[${item.title}] 반품 품목 스캔 완료 (${item.returnedQuantity}/${item.orderedQuantity})` });
        playSound("success");
      } else {
        setMessage({ type: "warning", text: `[${item.title}] 이미 주문 수량을 초과하여 반품 수량을 등록했습니다.` });
        playSound("warning");
      }
    } else {
      setMessage({ type: "error", text: "주문에 포함되지 않은 상품 바코드입니다!" });
      playSound("error");
    }

    setBarcode("");
  };

  const adjustQuantity = (itemId, amount) => {
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === itemId);
    if (index > -1) {
      const newQty = updatedItems[index].returnedQuantity + amount;
      if (newQty >= 0 && newQty <= updatedItems[index].orderedQuantity) {
        updatedItems[index].returnedQuantity = newQty;
        setCurrentOrder({ ...currentOrder, items: updatedItems });
      }
    }
  };

  const handleSaveReturn = () => {
    const returnedItems = currentOrder.items.filter(item => item.returnedQuantity > 0);
    if (returnedItems.length === 0) {
      setMessage({ type: "error", text: "반품 수량이 최소 1개 이상 입력되어야 합니다." });
      playSound("warning");
      return;
    }

    saveFetcher.submit(
      {
        intent: "save_return",
        orderName: currentOrder.name,
        isDamaged: String(isDamaged),
        damageReason: isDamaged ? damageReason : "",
        isProcessed: String(isProcessed),
        inspectorName: inspectorName || "",
        returnedAt: returnedAt,
        items: JSON.stringify(returnedItems)
      },
      { method: "POST" }
    );
  };

  const rows = currentOrder?.items.map(item => [
    <Thumbnail source={item.imageUrl || ""} alt={item.title} size="small" />,
    <BlockStack gap="100">
      <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
      <Text variant="bodySm" color="subdued">{item.variantTitle} | SKU: {item.sku || "N/A"}</Text>
    </BlockStack>,
    item.barcode || "N/A",
    `${item.orderedQuantity}개`,
    <InlineStack wrap={false} align="center" gap="200">
      <Button size="micro" onClick={() => adjustQuantity(item.id, -1)}>-</Button>
      <Text variant="bodyLg" fontWeight="bold">{item.returnedQuantity} 개</Text>
      <Button size="micro" onClick={() => adjustQuantity(item.id, 1)}>+</Button>
    </InlineStack>
  ]) || [];

  return (
    <Page
      title="반품 / 회수 스캔 검수"
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <Layout>
        {/* 반품 접수 폼 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                <Box grow>
                  <form onSubmit={(e) => { e.preventDefault(); handleOrderSearch(); }}>
                    <TextField
                      label="반품 주문 번호 또는 송장번호 검색 (예: #1001, 송장 바코드 스캔)"
                      value={orderName}
                      onChange={setOrderName}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      placeholder="# 주문 번호 또는 송장번호 입력"
                    />
                  </form>
                </Box>
                <Box paddingBlockStart="500">
                  <Button onClick={handleOrderSearch} loading={fetcher.state === "submitting"}>주문 불러오기</Button>
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

        {currentOrder && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">{currentOrder.name} 반품 상품 목록 스캔</Text>
                
                <form onSubmit={(e) => { e.preventDefault(); processBarcode(barcode); }}>
                  <TextField
                    label="반품 상품 바코드 스캔"
                    value={barcode}
                    onChange={setBarcode}
                    autoComplete="off"
                    prefix={<Icon source={BarcodeIcon} />}
                    ref={barcodeRef}
                    helpText="반품된 실물 상품의 바코드를 스캔하거나 +/- 버튼으로 조절하세요."
                  />
                </form>

                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["이미지", "상품 정보", "바코드", "주문 수량", "반품 등록 수량"]}
                  rows={rows}
                />

                <Divider />

                <Text variant="headingMd" as="h2">반품 상세 정보 기록</Text>

                <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <TextField
                      label="반송 받은 날짜"
                      type="date"
                      value={returnedAt}
                      onChange={setReturnedAt}
                      prefix={<Icon source={CalendarIcon} />}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <TextField
                      label="반품 검수자명"
                      value={inspectorName}
                      disabled
                      prefix={<Icon source={PersonIcon} />}
                    />
                  </div>
                </div>

                <InlineStack gap="600">
                  <Checkbox
                    label="물품 파손 있음 (Damaged)"
                    checked={isDamaged}
                    onChange={setIsDamaged}
                  />
                  <Checkbox
                    label="반품 처리 완료 (Processed)"
                    checked={isProcessed}
                    onChange={setIsProcessed}
                  />
                </InlineStack>

                {isDamaged && (
                  <TextField
                    label="파손 사유 및 상세 사유"
                    value={damageReason}
                    onChange={setDamageReason}
                    placeholder="예: 포장 훼손, 유통기한 임박, 용기 파손 등 사유를 적어주세요."
                    multiline={2}
                  />
                )}

                <Divider />

                <InlineStack align="end" gap="200">
                  <Button onClick={() => setCurrentOrder(null)}>취소</Button>
                  <Button primary onClick={handleSaveReturn} loading={saveFetcher.state === "submitting"}>
                    반품 기록 데이터베이스 최종 저장
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* 과거 반품 이력 히스토리 리스트 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">최근 반품 접수 내역 (실시간 15건)</Text>
              {returnHistory.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e1e3e5", textAlign: "left" }}>
                        <th style={{ padding: "10px 8px" }}>주문번호</th>
                        <th style={{ padding: "10px 8px" }}>반송 받은날짜</th>
                        <th style={{ padding: "10px 8px" }}>상태</th>
                        <th style={{ padding: "10px 8px" }}>검수자</th>
                        <th style={{ padding: "10px 8px" }}>반품 내역 요약</th>
                        <th style={{ padding: "10px 8px" }}>처리 여부</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnHistory.map((item) => (
                        <tr key={item.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                          <td style={{ padding: "10px 8px", fontWeight: "bold" }}>{item.orderName}</td>
                          <td style={{ padding: "10px 8px" }}>{dayjs(item.returnedAt).format("YYYY-MM-DD")}</td>
                          <td style={{ padding: "10px 8px" }}>
                            {item.isDamaged ? (
                              <Badge tone="critical">🚨 파손 ({item.damageReason || "사유 미정"})</Badge>
                            ) : (
                              <Badge tone="success">정상 상태</Badge>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px" }}>{item.inspectorName || "알 수 없음"}</td>
                          <td style={{ padding: "10px 8px" }}>
                            {item.items.map(subItem => `${subItem.productTitle} (${subItem.quantity}개)`).join(", ")}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            {item.isProcessed ? (
                              <Badge tone="info">완료</Badge>
                            ) : (
                              <Badge tone="attention">대기중</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  heading="아직 등록된 반품 내역이 없습니다."
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>주문 검색 후 반품 검수를 완료하시면 여기에 내역이 표시됩니다.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
