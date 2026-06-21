import { useState, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page, Layout, Card, TextField, BlockStack, InlineStack, Text,
  DataTable, Badge, Thumbnail, Button, Banner, Box, EmptyState,
  Icon, Divider, Modal, ChoiceList, ResourceList, ResourceItem, Avatar
} from "@shopify/polaris";
import { SearchIcon, BarcodeIcon, AlertTriangleIcon } from "@shopify/polaris-icons"; 
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getInspectorName(admin, session) {
  // 1. Try to get it from the online session
  if (session.firstName || session.lastName) {
    return `${session.firstName || ""} ${session.lastName || ""}`.trim();
  }

  // 2. Try currentStaffMember GraphQL (defensive in case scope is granted)
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
  } catch (e) {
    // Ignore error if scope read_users is not granted or query fails
  }

  // 3. Try fallback to shopOwner
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
  } catch (e) {
    // Ignore error
  }

  return "알 수 없음";
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const inspectorName = await getInspectorName(admin, session);
  return { inspectorName };
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
      { variables: { query: `name:${orderName}` } }
    );

    const json = await response.json();
    const order = json.data?.orders?.edges[0]?.node;

    if (!order) return { error: "주문을 찾을 수 없습니다." };

        // Fetch existing inspection record from local DB to merge
    const existingRecord = await prisma.inspectionRecord.findUnique({
      where: { orderId: order.id },
      include: { items: true }
    });

    const items = order.lineItems.edges.map(edge => {
      const lineItemId = edge.node.id;
      const variantId = edge.node.variant?.id;
      
      const existingItem = existingRecord?.items.find(
        item => item.variantId === variantId || (item.sku && item.sku === edge.node.sku)
      );

      return {
        id: lineItemId,
        variantId: variantId,
        title: edge.node.title,
        variantTitle: edge.node.variantTitle,
        sku: edge.node.sku,
        barcode: edge.node.variant?.barcode,
        imageUrl: edge.node.variant?.image?.url || edge.node.variant?.product?.featuredImage?.url || "",
        orderedQuantity: edge.node.quantity,
        inspectedQuantity: existingItem ? existingItem.inspectedQuantity : 0,
        issueType: existingItem ? existingItem.issueType : null,
        issueNote: existingItem ? existingItem.issueNote : "",
        substitutedVariantId: existingItem ? existingItem.substitutedVariantId : null,
        substitutedProductTitle: existingItem ? existingItem.substitutedProductTitle : "",
      };
    });

    return { order: { id: order.id, name: order.name, items } };
  }

  // ✨ 실제 스토어 상품 검색 연동
  if (intent === "search_substitute") {
    const query = formData.get("query");
    const escapedQuery = (query || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const searchQuery = `'${escapedQuery}' OR barcode:${escapedQuery} OR sku:${escapedQuery}`;

    try {
      const response = await admin.graphql(
        `#graphql
        query searchSubstituteVariants($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              id
              title
              sku
              barcode
              price
              product {
                title
              }
            }
          }
        }`,
        { variables: { query: searchQuery } }
      );

      const responseJson = await response.json();
      const variants = responseJson?.data?.productVariants?.nodes || [];

      const results = variants.map(variant => ({
        id: variant.id,
        title: `${variant.product?.title || ""} ${variant.title === "Default Title" ? "" : `(${variant.title})`}`.trim(),
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        price: variant.price || "0.00"
      }));

      return { results };
    } catch (e) {
      console.error("Error searching substitutes:", e);
      return { results: [] };
    }
  }

  if (intent === "save_inspection") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName");
    const items = JSON.parse(formData.get("items"));
    const inspectorName = formData.get("inspectorName");
    
    // ✨ 상태 판별 로직 고도화 (예외가 1개라도 있으면 STATUS 변경)
    let status = "SUCCESS";
    const hasIssue = items.some(item => item.issueType !== null);
    const isPartial = items.some(item => item.inspectedQuantity < item.orderedQuantity && item.issueType === null);

    if (hasIssue) {
      status = "ISSUE_REPORTED"; // DB 구조에 맞게 상태값 조정 가능 (예: SUBSTITUTED, REFUNDED)
    } else if (isPartial) {
      status = "PARTIAL";
    }

    // ✨ 중복 저장 시 크래시 방지를 위해 기존 내역을 안전하게 삭제 (Cascade 옵션으로 아이템 자동 삭제)
    await prisma.inspectionRecord.deleteMany({
      where: { orderId }
    });

    const record = await prisma.inspectionRecord.create({
      data: {
        orderId,
        orderName,
        shop: session.shop,
        status,
        inspectorName,
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
            // ✨ 예외 처리 기록 저장 활성화
            issueType: item.issueType,
            issueNote: item.issueNote,
            substitutedVariantId: item.substitutedVariantId,
            substitutedProductTitle: item.substitutedProductTitle,
          })),
        },
      },
    });

    return { success: true, recordId: record.id };
  }

  return null;
};

export default function Inspect() {
  const { inspectorName } = useLoaderData();
  const fetcher = useFetcher();
  const searchFetcher = useFetcher(); // 대체 상품 검색용
  const saveFetcher = useFetcher();

  const [orderName, setOrderName] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState(null);
  const barcodeRef = useRef(null);

  // ✨ 추가: URL 검색 파라미터 연동 자동 패치
  const [searchParams] = useSearchParams();
  const [hasAutoFetched, setHasAutoFetched] = useState(false);

  useEffect(() => {
    const paramOrderName = searchParams.get("orderName");
    if (paramOrderName && !hasAutoFetched) {
      setHasAutoFetched(true);
      setOrderName(paramOrderName);
      fetcher.submit(
        { intent: "fetch_order", orderName: paramOrderName },
        { method: "POST" }
      );
    }
  }, [searchParams, hasAutoFetched]);

  // ✨ 예외 처리 모달 관련 State
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [activeIssueItemId, setActiveIssueItemId] = useState(null);
  const [issueType, setIssueType] = useState(["REFUND"]); // ChoiceList는 배열 사용
  const [issueNote, setIssueNote] = useState("");
  const [substituteQuery, setSubstituteQuery] = useState("");
  const [selectedSubstitute, setSelectedSubstitute] = useState(null);

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

      if (item.issueType) {
        setMessage({ type: "warning", text: `[${item.title}] 이미 문제 보고(예외 처리)가 접수된 상품입니다.` });
      } else if (item.inspectedQuantity < item.orderedQuantity) {
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

  // ✨ 수동 수량 조절 (+/-)
  const adjustQuantity = (itemId, amount) => {
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === itemId);
    if (index > -1) {
      const newQty = updatedItems[index].inspectedQuantity + amount;
      if (newQty >= 0 && newQty <= updatedItems[index].orderedQuantity) {
        updatedItems[index].inspectedQuantity = newQty;
        setCurrentOrder({ ...currentOrder, items: updatedItems });
      }
    }
  };

  // ✨ 문제 보고 모달 열기
  const openIssueModal = (itemId) => {
    setActiveIssueItemId(itemId);
    const item = currentOrder.items.find(i => i.id === itemId);
    setIssueType([item.issueType || "REFUND"]);
    setIssueNote(item.issueNote || "");
    setSelectedSubstitute(item.substitutedVariantId ? { id: item.substitutedVariantId, title: item.substitutedProductTitle } : null);
    setSubstituteQuery("");
    setIssueModalOpen(true);
  };

  // ✨ 대체 상품 검색
  const handleSubstituteSearch = () => {
    if (!substituteQuery.trim()) return;
    searchFetcher.submit({ intent: "search_substitute", query: substituteQuery }, { method: "POST" });
  };

  // ✨ 예외 처리 내용 주문 데이터에 저장
  const saveIssueToOrder = () => {
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === activeIssueItemId);
    
    if (index > -1) {
      updatedItems[index].issueType = issueType[0];
      updatedItems[index].issueNote = issueNote;
      
      if (issueType[0] === "SUBSTITUTE" && selectedSubstitute) {
        updatedItems[index].substitutedVariantId = selectedSubstitute.id;
        updatedItems[index].substitutedProductTitle = selectedSubstitute.title;
      } else {
        updatedItems[index].substitutedVariantId = null;
        updatedItems[index].substitutedProductTitle = "";
      }
      
      // 예외 처리된 항목은 검수 수량을 0으로 초기화
      updatedItems[index].inspectedQuantity = 0;
      setCurrentOrder({ ...currentOrder, items: updatedItems });
    }
    setIssueModalOpen(false);
  };

  // ✨ 문제 보고 취소(초기화)
  const clearIssue = (itemId) => {
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === itemId);
    if (index > -1) {
      updatedItems[index].issueType = null;
      updatedItems[index].issueNote = "";
      updatedItems[index].substitutedVariantId = null;
      updatedItems[index].substitutedProductTitle = "";
      setCurrentOrder({ ...currentOrder, items: updatedItems });
    }
  };

  const handleSave = () => {
    saveFetcher.submit(
      {
        intent: "save_inspection",
        orderId: currentOrder.id,
        orderName: currentOrder.name,
        items: JSON.stringify(currentOrder.items),
        inspectorName: inspectorName || "",
      },
      { method: "POST" }
    );
  };

  const rows = currentOrder?.items.map(item => {
    // 뱃지 상태 결정
    let statusBadge = <Badge tone="attention">대기</Badge>;
    if (item.issueType) {
      statusBadge = <Badge tone="critical">🚨 {item.issueType}</Badge>;
    } else if (item.inspectedQuantity === item.orderedQuantity) {
      statusBadge = <Badge tone="success">✅ 완료</Badge>;
    }

    return [
      <Thumbnail source={item.imageUrl || ""} alt={item.title} size="small" />,
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
        <Text variant="bodySm" color="subdued">{item.variantTitle} | SKU: {item.sku || "N/A"}</Text>
        
        {/* 예외 처리 메모 표시 */}
        {item.issueType && (
          <div style={{ marginTop: "4px", background: "#fef2f2", padding: "6px", borderRadius: "6px", border: "1px solid #fca5a5", fontSize: "12px" }}>
            <span style={{ fontWeight: "bold", color: "#b91c1c" }}>
              {item.issueType === "REFUND" && "💸 환불 처리 요청"}
              {item.issueType === "CREDIT" && "🪙 포인트 적립 요청"}
              {item.issueType === "SUBSTITUTE" && "🔄 상품 대체 요청"}
            </span>
            {item.substitutedProductTitle && <div>→ 대체: {item.substitutedProductTitle}</div>}
            {item.issueNote && <div style={{ color: "#7f1d1d", marginTop: "2px" }}>메모: {item.issueNote}</div>}
            <Button variant="plain" tone="critical" size="micro" onClick={() => clearIssue(item.id)}>예외 처리 취소</Button>
          </div>
        )}
      </BlockStack>,
      item.barcode || "N/A",
      
      /* ✨ 수동 수량 조절 UI */
      <InlineStack wrap={false} align="center" gap="200">
        <Button size="micro" onClick={() => adjustQuantity(item.id, -1)} disabled={item.inspectedQuantity === 0 || item.issueType}>-</Button>
        <Text variant="bodyLg" fontWeight="bold">{item.inspectedQuantity} / {item.orderedQuantity}</Text>
        <Button size="micro" onClick={() => adjustQuantity(item.id, 1)} disabled={item.inspectedQuantity === item.orderedQuantity || item.issueType}>+</Button>
      </InlineStack>,
      
      /* 상태 및 문제보고 버튼 */
      <BlockStack align="center" gap="200">
        {statusBadge}
        {!item.issueType && item.inspectedQuantity < item.orderedQuantity && (
          <Button size="micro" tone="critical" onClick={() => openIssueModal(item.id)}>🚨 문제 보고</Button>
        )}
      </BlockStack>
    ];
  }) || [];

  return (
    <Page
      title="주문 검수 (Scan-to-Verify)"
      subtitle={inspectorName ? `현재 검수자: ${inspectorName}` : undefined}
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                <Box grow>
                  <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                    <TextField
                      label="주문 번호 검색 (예: #1001)"
                      value={orderName}
                      onChange={setOrderName}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />} 
                    />
                  </form>
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

        <Layout.Section>
          {currentOrder ? (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">{currentOrder.name} 검수 리스트</Text>
                  
                  <form onSubmit={(e) => { e.preventDefault(); processBarcode(barcode); }}>
                    <TextField
                      label="상품 바코드 스캔"
                      value={barcode}
                      onChange={setBarcode}
                      autoComplete="off"
                      prefix={<Icon source={BarcodeIcon} />} 
                      ref={barcodeRef}
                      helpText="상품의 바코드를 스캔하거나 우측의 +/- 버튼으로 수동 검수하세요."
                    />
                  </form>

                  <div style={{ overflowX: "auto" }}>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                      headings={['이미지', '상품 정보', '바코드', '수량 (스캔/주문)', '상태/처리']}
                      rows={rows}
                    />
                  </div>
                  <Divider />
                  <InlineStack align="end">
                    <Button onClick={() => setCurrentOrder(null)}>취소</Button>
                    <Button primary onClick={handleSave} loading={saveFetcher.state === "submitting"}>
                      검수 데이터 최종 전송
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

      {/* ✨ 결품 및 예외 처리 모달 */}
      <Modal
        open={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        title="품절 및 문제 보고"
        primaryAction={{ content: '보고 사항 저장', onAction: saveIssueToOrder }}
        secondaryActions={[{ content: '취소', onAction: () => setIssueModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              결품이나 문제가 발생한 상품의 후속 처리 방안을 선택해 주세요. (CS팀에 전달됩니다)
            </Text>
            
            <ChoiceList
              title="해결 옵션"
              choices={[
                {label: '💸 고객에게 환불 처리 (Refund)', value: 'REFUND'},
                {label: '🪙 스토어 포인트 지급 (Credit)', value: 'CREDIT'},
                {label: '🔄 다른 상품으로 대체 발송 (Substitute)', value: 'SUBSTITUTE'},
              ]}
              selected={issueType}
              onChange={setIssueType}
            />

            {issueType[0] === "SUBSTITUTE" && (
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">대체 상품 검색</Text>
                <InlineStack gap="200">
                  <Box grow>
                    <form onSubmit={(e) => { e.preventDefault(); handleSubstituteSearch(); }}>
                      <TextField
                        value={substituteQuery}
                        onChange={setSubstituteQuery}
                        placeholder="상품명이나 바코드로 검색"
                        autoComplete="off"
                      />
                    </form>
                  </Box>
                  <Button onClick={handleSubstituteSearch} loading={searchFetcher.state === "submitting"}>검색</Button>
                </InlineStack>

                {/* 대체 상품 검색 결과 리스트 */}
                {searchFetcher.data?.results && (
                  <ResourceList
                    resourceName={{ singular: '상품', plural: '상품' }}
                    items={searchFetcher.data.results}
                    renderItem={(item) => (
                      <ResourceItem
                        id={item.id}
                        onClick={() => setSelectedSubstitute(item)}
                        media={<Avatar customer size="sm" name={item.title} />}
                      >
                        <BlockStack>
                          <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
                          <Text variant="bodySm" tone="subdued">SKU: {item.sku} | {item.price} EUR</Text>
                        </BlockStack>
                      </ResourceItem>
                    )}
                  />
                )}

                {/* 선택된 대체 상품 표시 */}
                {selectedSubstitute && (
                  <div style={{ background: "#ecfdf3", padding: "10px", borderRadius: "8px", border: "1px solid #86efac", color: "#166534" }}>
                    ✅ <strong>선택됨:</strong> {selectedSubstitute.title}
                  </div>
                )}
              </BlockStack>
            )}

            <TextField
              label="상세 사유 (선택)"
              value={issueNote}
              onChange={setIssueNote}
              multiline={2}
              placeholder="예: 파손품 발견, 전산 재고 오류 등"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}