import { useMemo, useState } from "react";
import { useLoaderData, useActionData, useSubmit, useSearchParams } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Select,
} from "@shopify/polaris";
import {
  PrintIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generatePickListPdfBuffer } from "../utils/pickListPrint";
import { fetchOdooBinLocations } from "../services/odooClient.server.js";
import { sendPickListEmailWithPdf } from "../utils/emailService.js";
import AppEmptyState from "../components/common/AppEmptyState";
import MetricCard from "../components/common/MetricCard";

// ========================================================
// GraphQL Query with Cursor Pagination
// ========================================================
const UNFULFILLED_ORDERS_QUERY = `#graphql
  query UnfulfilledOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "status:open fulfillment_status:unfulfilled") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        displayFinancialStatus
        cancelledAt
        shippingAddress {
          name
          company
        }
        lineItems(first: 100) { 
          nodes {
            quantity
            name
            variant { 
              id
              sku
              barcode
              inventoryQuantity 
              product { 
                title 
                producttype: metafield(namespace: "custom", key: "producttype") { value }
              } 
            }
          }
        }
      }
    }
  }
`;

function parseLocationKey(loc) {
  if (!loc || loc === "위치 미정" || loc === "위치 미지정") {
    return { priority: 99, raw: "ZZZ" };
  }
  let priority = 10;
  let clean = loc.trim();
  if (clean.startsWith("!")) {
    priority = 1;
    clean = clean.slice(1).trim();
  } else if (clean.startsWith("*")) {
    priority = 50;
    clean = clean.slice(1).trim();
  }
  return { priority, raw: clean };
}

function sortBinLocations(a, b) {
  const keyA = parseLocationKey(a.binLocation || "");
  const keyB = parseLocationKey(b.binLocation || "");

  if (keyA.priority !== keyB.priority) {
    return keyA.priority - keyB.priority;
  }
  return keyA.raw.localeCompare(keyB.raw, undefined, { numeric: true, sensitivity: "base" });
}

async function loadPickListData(admin, tempFilter = "ALL") {
  const itemMap = new Map();
  let hasNextPage = true;
  let after = null;
  const filteredOrders = [];

  while (hasNextPage) {
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, { variables: { first: 100, after } });
    const payload = await response.json();
    const orders = payload?.data?.orders?.nodes ?? [];

    for (const order of orders) {
      if (order.cancelledAt) continue;
      filteredOrders.push(order);
    }
    hasNextPage = Boolean(payload?.data?.orders?.pageInfo?.hasNextPage);
    after = payload?.data?.orders?.pageInfo?.endCursor || null;
  }

  // Filter orders based on temperature (DRY vs ALL)
  const finalOrders = [];
  for (const order of filteredOrders) {
    const items = order.lineItems?.nodes ?? [];
    const isDryOnly = items.every((item) => {
      const pType = (item.variant?.product?.producttype?.value || "t").trim().toLowerCase();
      return pType === "t" || pType === "";
    });

    if (tempFilter === "DRY_ONLY") {
      if (isDryOnly) {
        finalOrders.push(order);
      }
    } else {
      finalOrders.push(order);
    }
  }

  // Aggregate items across selected orders
  for (const order of finalOrders) {
    const orderNumber = order.name;
    for (const lineItem of order?.lineItems?.nodes ?? []) {
      const variant = lineItem.variant;
      const sku = variant?.sku || "-";
      const productName = variant?.product?.title || lineItem.name || "알 수 없는 상품";
      const key = variant?.id || `${productName}__${sku}`;

      if (!itemMap.has(key)) {
        itemMap.set(key, {
          productName,
          sku,
          barcode: variant?.barcode || "-",
          orderedQty: 0,
          inventoryQty: typeof variant?.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
          binLocation: "조회중",
          orderNumbers: new Set(),
        });
      }
      const current = itemMap.get(key);
      current.orderedQty += lineItem.quantity || 0;
      current.orderNumbers.add(orderNumber);
    }
  }

  const allSkus = Array.from(itemMap.values()).map((i) => i.sku).filter((sku) => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    .sort(sortBinLocations);

  return {
    items,
    ordersList: finalOrders.map((o) => ({ id: o.id, name: o.name })),
    totalOrdersCount: finalOrders.length,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
    tempFilter,
  };
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const urlObj = new URL(request.url);
  const tempFilter = urlObj.searchParams.get("tempFilter") || "ALL";
  return await loadPickListData(admin, tempFilter);
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const clientTime = formData.get("clientTime");
  const techTime = formData.get("techTime");

  if (intent === "send-email") {
    const items = JSON.parse(formData.get("items") || "[]");
    const ordersPayload = JSON.parse(formData.get("ordersPayload") || "[]");

    // 1. Record print status in DB
    const updatePromises = ordersPayload.map(async (order) => {
      try {
        await prisma.inspectionRecord.upsert({
          where: { orderId: order.id },
          update: { isPickListPrinted: true },
          create: {
            orderId: order.id,
            orderName: order.name,
            shop: session.shop,
            status: "PENDING",
            isPickListPrinted: true,
          },
        });
      } catch (err) {
        console.error(`DB update failed for order ${order.name}:`, err.message);
      }
    });
    await Promise.all(updatePromises);

    // 2. Generate PDF and dispatch via Brevo HTTP API
    try {
      const pdfBuffer = await generatePickListPdfBuffer(items, techTime);
      const base64Pdf = pdfBuffer.toString("base64");
      const mailTitle = `${clientTime} 기준 처리중 피킹 리스트`;

      await sendPickListEmailWithPdf({
        mailTitle,
        base64Pdf,
        techTime,
      });

      return { success: true, message: "피킹 리스트 PDF가 물류 이메일로 발송되었습니다." };
    } catch (err) {
      console.error("PDF dispatch failed:", err.message);
      return { success: false, error: `이메일 발송 실패: ${err.message}` };
    }
  }

  return null;
};

export default function PickListPage() {
  const {
    items,
    ordersList,
    totalOrdersCount,
    totalUnfulfilledProducts,
    totalOrderedQty,
    tempFilter,
  } = useLoaderData();

  const actionData = useActionData();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLocation, setSelectedLocation] = useState("ALL");

  // Filter items by location
  const uniqueLocations = useMemo(() => {
    const locSet = new Set(items.map((i) => i.binLocation));
    return Array.from(locSet);
  }, [items]);

  const displayedItems = useMemo(() => {
    if (selectedLocation === "ALL") return items;
    return items.filter((i) => i.binLocation === selectedLocation);
  }, [items, selectedLocation]);

  // Group items by Location for warehouse walking efficiency
  const groupedByLocation = useMemo(() => {
    const groups = new Map();
    displayedItems.forEach((item) => {
      const loc = item.binLocation || "위치 미정";
      if (!groups.has(loc)) {
        groups.set(loc, []);
      }
      groups.get(loc).push(item);
    });
    return groups;
  }, [displayedItems]);

  const handlePrint = () => {
    window.print();
  };

  const handlePrintAndEmail = () => {
    const now = new Date();
    const formattedTime = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const techTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    submit(
      {
        intent: "send-email",
        clientTime: formattedTime,
        techTime,
        items: JSON.stringify(items),
        ordersPayload: JSON.stringify(ordersList || []),
      },
      { method: "post" }
    );

    window.print();
  };

  return (
    <Page
      title="피킹 및 처리중 리스트 (Pick List)"
      subtitle="미처리 주문 전체를 위치(Bin Location) 동선 기준으로 자동 정렬하여 출고 피킹합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={{
        content: "PDF 인쇄 및 이메일 전송",
        icon: PrintIcon,
        disabled: items.length === 0,
        onAction: handlePrintAndEmail,
      }}
      secondaryActions={[
        {
          content: "단순 인쇄 (A4 가로)",
          icon: PrintIcon,
          disabled: items.length === 0,
          onAction: handlePrint,
        },
      ]}
    >
      <BlockStack gap="400">
        {/* 인쇄 전용 스타일 */}
        <style>{`
          @media print {
            button, .no-print, nav, header { display: none !important; }
            body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; }
            @page { size: A4 landscape; margin: 8mm 6mm; }
            table { width: 100% !important; border-collapse: collapse !important; }
            th { background: #0f172a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 6px 8px !important; font-size: 11px !important; }
            td { border-bottom: 1px solid #cbd5e1 !important; padding: 6px 8px !important; font-size: 11px !important; }
          }
        `}</style>

        {actionData?.message && (
          <Banner tone="success">
            <p>{actionData.message}</p>
          </Banner>
        )}

        {actionData?.error && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {/* 1. 핵심 메트릭 카드 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          <MetricCard
            title="미처리 대상 주문"
            value={`${totalOrdersCount.toLocaleString()} 건`}
            variant="primary"
          />
          <MetricCard
            title="피킹 대상 상품 수"
            value={`${totalUnfulfilledProducts.toLocaleString()} 종`}
          />
          <MetricCard
            title="총 피킹 수량"
            value={`${totalOrderedQty.toLocaleString()} 개`}
          />
        </div>

        {/* 2. 필터 제어 바 */}
        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="300" blockAlign="center">
              <Select
                label="온도대 필터"
                labelInline
                options={[
                  { label: "전체 주문 (상온+냉장/냉동)", value: "ALL" },
                  { label: "상온 단독 주문만 (Dry Only)", value: "DRY_ONLY" },
                ]}
                value={tempFilter}
                onChange={(val) => {
                  searchParams.set("tempFilter", val);
                  setSearchParams(searchParams);
                }}
              />

              <Select
                label="위치별 보기"
                labelInline
                options={[
                  { label: `전체 위치 (${uniqueLocations.length}구역)`, value: "ALL" },
                  ...uniqueLocations.map((loc) => ({ label: loc, value: loc })),
                ]}
                value={selectedLocation}
                onChange={setSelectedLocation}
              />
            </InlineStack>

            <Text variant="bodySm" tone="subdued">
              정렬 기준: 창고 동선 우선 (Zone → Aisle → Shelf)
            </Text>
          </InlineStack>
        </Card>

        {/* 3. 위치별 그룹화 피킹 리스트 테이블 */}
        {displayedItems.length > 0 ? (
          <BlockStack gap="400">
            {Array.from(groupedByLocation.entries()).map(([loc, locItems]) => {
              const isNoLocation = loc.includes("위치 미정") || loc.includes("위치 미지정");

              return (
                <Card key={loc} padding="0">
                  <Box padding="300" background={isNoLocation ? "bg-surface-warning-subdued" : "bg-surface-secondary"}>
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingSm" as="h3" fontWeight="bold">
                          위치: {loc}
                        </Text>
                        <Badge tone={isNoLocation ? "warning" : "info"}>
                          {locItems.length}종 품목
                        </Badge>
                      </InlineStack>

                      <Text variant="bodySm" fontWeight="semibold">
                        합계 {locItems.reduce((sum, i) => sum + i.orderedQty, 0)}개 피킹
                      </Text>
                    </InlineStack>
                  </Box>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #cbd5e1", backgroundColor: "#f8fafc", textAlign: "left" }}>
                        <th style={{ padding: "10px 12px", width: "20%" }}>창고 위치 (레갈 번호)</th>
                        <th style={{ padding: "10px 12px", width: "32%" }}>상품명</th>
                        <th style={{ padding: "10px 12px", width: "16%" }}>SKU / 바코드</th>
                        <th style={{ padding: "10px 12px", width: "11%", textAlign: "right" }}>피킹 수량</th>
                        <th style={{ padding: "10px 12px", width: "11%", textAlign: "right" }}>현재 재고</th>
                        <th style={{ padding: "10px 12px", width: "10%" }}>관련 주문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td
                            style={{
                              padding: "10px 12px",
                              fontWeight: "bold",
                              color: item.binLocation.startsWith("*")
                                ? "#0891b2"
                                : item.binLocation.includes("미지정")
                                ? "#b45309"
                                : "#1d4ed8",
                              backgroundColor: item.binLocation.startsWith("*")
                                ? "#ecfeff"
                                : item.binLocation.includes("미지정")
                                ? "#fffbeb"
                                : "#eff6ff",
                            }}
                          >
                            {item.binLocation}
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: "bold" }}>
                            {item.productName}
                          </td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#475569" }}>
                            <div>{item.sku}</div>
                            <div style={{ fontSize: "11px", color: "#94a3b8" }}>{item.barcode}</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold", fontSize: "15px" }}>
                            {item.orderedQty} 개
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            {item.inventoryQty !== null ? (
                              <Text tone={item.inventoryQty < 5 ? "critical" : item.inventoryQty < 10 ? "warning" : undefined}>
                                {item.inventoryQty} 개
                              </Text>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: "11px", color: "#64748b" }}>
                            {item.orderNumbers.slice(0, 3).join(", ")}
                            {item.orderNumbers.length > 3 && ` 외 ${item.orderNumbers.length - 3}건`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </BlockStack>
        ) : (
          <Card>
            <AppEmptyState
              title="피킹 대상 주문이 없습니다"
              description="현재 출고 대기 중인 미처리 주문이 모두 완료되었거나 조건에 맞는 주문이 없습니다."
            />
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}