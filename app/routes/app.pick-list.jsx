import { useMemo, useState } from "react";
import { useLoaderData, useActionData, useSubmit, useSearchParams } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Box,
  Select,
  ButtonGroup,
  Button,
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

/**
 * Parses bin location string into warehouse category and individual shelf locations
 */
export function parseWarehouseInfo(binLocation = "") {
  const loc = (binLocation || "").trim();
  if (!loc || loc === "위치 미정" || loc === "위치 미지정" || loc === "조회중") {
    return {
      category: "NO_BIN",
      label: "위치 미지정",
      storeShelf: null,
      newShelf: null,
      isStore: false,
      isNewOnly: false,
      hasBoth: false,
    };
  }

  // 매장창고 + 신창고 결합: e.g. "A-01-02 (신창고: B-04)"
  const matchBoth = loc.match(/^(.*?)\s*\(신창고:\s*(.*?)\)$/);
  if (matchBoth) {
    return {
      category: "STORE",
      label: loc,
      storeShelf: matchBoth[1].trim(),
      newShelf: matchBoth[2].trim(),
      isStore: true,
      isNewOnly: false,
      hasBoth: true,
    };
  }

  // 신창고 전용: e.g. "*W-05 (신창고)" 또는 "*W-05"
  if (loc.startsWith("*") || loc.includes("신창고")) {
    const cleanNew = loc.replace(/^\*/, "").replace(/\(신창고\)/, "").trim();
    return {
      category: "NEW_ONLY",
      label: loc,
      storeShelf: null,
      newShelf: cleanNew,
      isStore: false,
      isNewOnly: true,
      hasBoth: false,
    };
  }

  // 매장창고 단독: e.g. "A-01-02"
  return {
    category: "STORE",
    label: loc,
    storeShelf: loc,
    newShelf: null,
    isStore: true,
    isNewOnly: false,
    hasBoth: false,
  };
}

/**
 * Sorts items by warehouse priority: STORE items first -> NEW_ONLY items -> NO_BIN
 */
function sortBinLocations(a, b) {
  const infoA = parseWarehouseInfo(a.binLocation);
  const infoB = parseWarehouseInfo(b.binLocation);

  const priority = { STORE: 1, NEW_ONLY: 2, NO_BIN: 3 };
  if (priority[infoA.category] !== priority[infoB.category]) {
    return priority[infoA.category] - priority[infoB.category];
  }

  const keyA = infoA.storeShelf || infoA.newShelf || "ZZZ";
  const keyB = infoB.storeShelf || infoB.newShelf || "ZZZ";
  return keyA.localeCompare(keyB, undefined, { numeric: true, sensitivity: "base" });
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
    .map((item) => {
      const binLocation = odooBins[item.sku] || "위치 미지정";
      const whInfo = parseWarehouseInfo(binLocation);

      return {
        ...item,
        binLocation,
        whInfo,
        orderNumbers: Array.from(item.orderNumbers).sort(),
      };
    })
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

  // Warehouse Tabs: "ALL" | "STORE" | "NEW_ONLY" | "NO_BIN"
  const [warehouseTab, setWarehouseTab] = useState("ALL");
  const [selectedLocation, setSelectedLocation] = useState("ALL");

  // Summary counts per warehouse
  const { storeItems, newOnlyItems, noBinItems } = useMemo(() => {
    const store = [];
    const newOnly = [];
    const noBin = [];

    items.forEach((item) => {
      const cat = item.whInfo?.category || "NO_BIN";
      if (cat === "STORE") {
        store.push(item);
      } else if (cat === "NEW_ONLY") {
        newOnly.push(item);
      } else {
        noBin.push(item);
      }
    });

    return { storeItems: store, newOnlyItems: newOnly, noBinItems: noBin };
  }, [items]);

  const storeQty = useMemo(() => storeItems.reduce((sum, i) => sum + i.orderedQty, 0), [storeItems]);
  const newOnlyQty = useMemo(() => newOnlyItems.reduce((sum, i) => sum + i.orderedQty, 0), [newOnlyItems]);
  const noBinQty = useMemo(() => noBinItems.reduce((sum, i) => sum + i.orderedQty, 0), [noBinItems]);

  // Filter items by active warehouse tab
  const tabFilteredItems = useMemo(() => {
    if (warehouseTab === "STORE") return storeItems;
    if (warehouseTab === "NEW_ONLY") return newOnlyItems;
    if (warehouseTab === "NO_BIN") return noBinItems;
    return items;
  }, [warehouseTab, storeItems, newOnlyItems, noBinItems, items]);

  // Unique location list for dropdown within the active warehouse view
  const uniqueLocations = useMemo(() => {
    const locSet = new Set(tabFilteredItems.map((i) => i.binLocation));
    return Array.from(locSet);
  }, [tabFilteredItems]);

  const displayedItems = useMemo(() => {
    if (selectedLocation === "ALL") return tabFilteredItems;
    return tabFilteredItems.filter((i) => i.binLocation === selectedLocation);
  }, [tabFilteredItems, selectedLocation]);

  // Group items by Location for warehouse walking efficiency
  const groupedByLocation = useMemo(() => {
    const groups = new Map();
    displayedItems.forEach((item) => {
      const loc = item.binLocation || "위치 미지정";
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
        items: JSON.stringify(displayedItems),
        ordersPayload: JSON.stringify(ordersList || []),
      },
      { method: "post" }
    );

    window.print();
  };

  return (
    <Page
      title="피킹 및 처리중 리스트 (Pick List)"
      subtitle="매장창고와 신창고 동선을 분리하여 출고 피킹 작업을 지원합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={{
        content: "PDF 인쇄 및 이메일 전송",
        icon: PrintIcon,
        disabled: displayedItems.length === 0,
        onAction: handlePrintAndEmail,
      }}
      secondaryActions={[
        {
          content: "단순 인쇄 (A4 가로)",
          icon: PrintIcon,
          disabled: displayedItems.length === 0,
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

        {/* 1. 핵심 메트릭 카드 (매장창고 / 신창고 담당자 분리 지표) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "14px",
          }}
        >
          <MetricCard
            title="미처리 대상 주문"
            value={`${totalOrdersCount.toLocaleString()} 건`}
            variant="primary"
          />
          <MetricCard
            title="매장창고 피킹 대상"
            value={`${storeItems.length}종 (${storeQty}개)`}
          />
          <MetricCard
            title="신창고 전용 피킹"
            value={`${newOnlyItems.length}종 (${newOnlyQty}개)`}
          />
          <MetricCard
            title="위치 미지정"
            value={`${noBinItems.length}종 (${noBinQty}개)`}
          />
        </div>

        {/* 2. 창고별 분리 탭 (STORE vs NEW vs ALL) */}
        <Card padding="300">
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <ButtonGroup segmented>
                <Button
                  pressed={warehouseTab === "ALL"}
                  onClick={() => {
                    setWarehouseTab("ALL");
                    setSelectedLocation("ALL");
                  }}
                >
                  {`전체 목록 (${items.length}종)`}
                </Button>
                <Button
                  pressed={warehouseTab === "STORE"}
                  onClick={() => {
                    setWarehouseTab("STORE");
                    setSelectedLocation("ALL");
                  }}
                >
                  {`매장창고 피킹 (STORE) [${storeItems.length}종 / ${storeQty}개]`}
                </Button>
                <Button
                  pressed={warehouseTab === "NEW_ONLY"}
                  onClick={() => {
                    setWarehouseTab("NEW_ONLY");
                    setSelectedLocation("ALL");
                  }}
                >
                  {`신창고 전용 피킹 (NEW WH) [${newOnlyItems.length}종 / ${newOnlyQty}개]`}
                </Button>
                <Button
                  pressed={warehouseTab === "NO_BIN"}
                  onClick={() => {
                    setWarehouseTab("NO_BIN");
                    setSelectedLocation("ALL");
                  }}
                >
                  {`위치 미지정 [${noBinItems.length}종]`}
                </Button>
              </ButtonGroup>

              <InlineStack gap="200" blockAlign="center">
                <Select
                  label="온도대"
                  labelInline
                  options={[
                    { label: "전체 주문", value: "ALL" },
                    { label: "상온 단독만", value: "DRY_ONLY" },
                  ]}
                  value={tempFilter}
                  onChange={(val) => {
                    searchParams.set("tempFilter", val);
                    setSearchParams(searchParams);
                  }}
                />

                {uniqueLocations.length > 1 && (
                  <Select
                    label="구역"
                    labelInline
                    options={[
                      { label: `전체 구역 (${uniqueLocations.length})`, value: "ALL" },
                      ...uniqueLocations.map((loc) => ({ label: loc, value: loc })),
                    ]}
                    value={selectedLocation}
                    onChange={setSelectedLocation}
                  />
                )}
              </InlineStack>
            </InlineStack>

            <Text variant="bodyXs" tone="subdued">
              매장창고와 신창고에 모두 재고가 있는 품목은 매장창고 탭에 우선 표시되며 신창고 레갈 위치가 함께 안내됩니다.
            </Text>
          </BlockStack>
        </Card>

        {/* 3. 위치별 그룹화 피킹 리스트 테이블 */}
        {displayedItems.length > 0 ? (
          <BlockStack gap="400">
            {Array.from(groupedByLocation.entries()).map(([loc, locItems]) => {
              const whInfo = locItems[0]?.whInfo || parseWarehouseInfo(loc);
              const isNoLocation = whInfo.category === "NO_BIN";
              const isNewOnly = whInfo.category === "NEW_ONLY";

              let headerBg = "bg-surface-secondary";
              let badgeTone = "info";
              let badgeText = "매장창고";

              if (isNoLocation) {
                headerBg = "bg-surface-warning-subdued";
                badgeTone = "warning";
                badgeText = "위치 미지정";
              } else if (isNewOnly) {
                headerBg = "bg-surface-caution-subdued";
                badgeTone = "attention";
                badgeText = "신창고 전용";
              } else if (whInfo.hasBoth) {
                badgeText = "매장+신창고";
              }

              return (
                <Card key={loc} padding="0">
                  <Box padding="300" background={headerBg}>
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={badgeTone}>{badgeText}</Badge>
                        <Text variant="headingSm" as="h3" fontWeight="bold">
                          {`위치: ${loc}`}
                        </Text>
                        <Badge tone="subdued">{`${locItems.length}종 품목`}</Badge>
                      </InlineStack>

                      <Text variant="bodySm" fontWeight="semibold">
                        {`합계 ${locItems.reduce((sum, i) => sum + i.orderedQty, 0)}개 피킹`}
                      </Text>
                    </InlineStack>
                  </Box>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #cbd5e1", backgroundColor: "#f8fafc", textAlign: "left" }}>
                        <th style={{ padding: "10px 12px", width: "22%" }}>창고 위치 (레갈 번호)</th>
                        <th style={{ padding: "10px 12px", width: "32%" }}>상품명</th>
                        <th style={{ padding: "10px 12px", width: "16%" }}>SKU / 바코드</th>
                        <th style={{ padding: "10px 12px", width: "10%", textAlign: "right" }}>피킹 수량</th>
                        <th style={{ padding: "10px 12px", width: "10%", textAlign: "right" }}>현재 재고</th>
                        <th style={{ padding: "10px 12px", width: "10%" }}>관련 주문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locItems.map((item, idx) => {
                        const itemWh = item.whInfo || parseWarehouseInfo(item.binLocation);

                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            {/* 창고 위치 및 레갈 번호 셀 */}
                            <td
                              style={{
                                padding: "10px 12px",
                                backgroundColor: itemWh.isNewOnly
                                  ? "#ecfeff"
                                  : itemWh.category === "NO_BIN"
                                  ? "#fffbeb"
                                  : "#eff6ff",
                              }}
                            >
                              <BlockStack gap="050">
                                <InlineStack gap="100" blockAlign="center">
                                  {itemWh.isNewOnly ? (
                                    <Badge tone="attention">신창고</Badge>
                                  ) : itemWh.category === "NO_BIN" ? (
                                    <Badge tone="warning">미지정</Badge>
                                  ) : (
                                    <Badge tone="info">매장</Badge>
                                  )}

                                  <Text variant="bodySm" fontWeight="bold">
                                    {itemWh.storeShelf || itemWh.newShelf || item.binLocation}
                                  </Text>
                                </InlineStack>

                                {itemWh.hasBoth && itemWh.newShelf && (
                                  <Text variant="bodyXs" tone="subdued">
                                    {`(신창고: ${itemWh.newShelf})`}
                                  </Text>
                                )}
                              </BlockStack>
                            </td>

                            <td style={{ padding: "10px 12px", fontWeight: "bold" }}>
                              {item.productName}
                            </td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#475569" }}>
                              <div>{item.sku}</div>
                              <div style={{ fontSize: "11px", color: "#94a3b8" }}>{item.barcode}</div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold", fontSize: "15px" }}>
                              {`${item.orderedQty} 개`}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              {item.inventoryQty !== null ? (
                                <Text tone={item.inventoryQty < 5 ? "critical" : item.inventoryQty < 10 ? "warning" : undefined}>
                                  {`${item.inventoryQty} 개`}
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
                        );
                      })}
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
              description="선택한 창고 조건에 해당하는 미처리 주문이 없거나 피킹이 완료되었습니다."
            />
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}