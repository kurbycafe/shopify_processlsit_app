import { loadProcessingList } from "../services/pickListData.server.js";
import { useMemo, useState } from "react";
import { useLoaderData, useActionData, useSubmit, useSearchParams, useRevalidator } from "react-router";
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
import { generatePickListPrintHtml } from "../utils/pickListPrintHtml";
import { parseWarehouseInfo, compareRegalAscending } from "../utils/warehouseHelpers.js";
import { fetchOdooBinLocations } from "../services/odooClient.server.js";
import { sendPickListEmailWithPdf } from "../utils/emailService.js";
import AppEmptyState from "../components/common/AppEmptyState";
import MetricCard from "../components/common/MetricCard";

export { parseWarehouseInfo, compareRegalAscending };

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return loadProcessingList({ admin, fetchBins: skus => fetchOdooBinLocations(skus, { strict: true }) });
};

// Temperature is a view of the same snapshot, not a reason to reload Shopify/Odoo.
export { shouldRevalidate } from "../utils/processingListNavigation.js";

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
      const mailTitle = `${clientTime} 기준 처리중 리스트`;

      await sendPickListEmailWithPdf({
        mailTitle,
        base64Pdf,
        techTime,
      });

      return { success: true, message: "처리중 리스트 PDF가 물류 이메일로 발송되었습니다." };
    } catch (err) {
      console.error("PDF dispatch failed:", err.message);
      return { success: false, error: `이메일 발송 실패: ${err.message}` };
    }
  }

  return null;
};

export default function PickListPage() {
  const { views, fetchedAt } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const tempFilter = searchParams.get('tempFilter') === 'DRY_ONLY' ? 'DRY_ONLY' : 'ALL';
  const { items, ordersList, totalOrdersCount, totalUnfulfilledProducts, totalOrderedQty } = views[tempFilter];

  // Warehouse Tabs: "ALL" | "STORE" | "NEW_ONLY" | "NO_BIN"
  const [warehouseTab, setWarehouseTab] = useState("ALL");
  const [selectedLocation, setSelectedLocation] = useState("ALL");

  // Segregate and sort each warehouse category in ascending Regal order
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

    store.sort(compareRegalAscending);
    newOnly.sort(compareRegalAscending);
    noBin.sort(compareRegalAscending);

    return { storeItems: store, newOnlyItems: newOnly, noBinItems: noBin };
  }, [items]);

  const storeQty = useMemo(() => storeItems.reduce((sum, i) => sum + i.orderedQty, 0), [storeItems]);
  const newOnlyQty = useMemo(() => newOnlyItems.reduce((sum, i) => sum + i.orderedQty, 0), [newOnlyItems]);
  const noBinQty = useMemo(() => noBinItems.reduce((sum, i) => sum + i.orderedQty, 0), [noBinItems]);

  // Items to display based on selected warehouse tab and sub-location filter
  const displayedItems = useMemo(() => {
    let base = items;
    if (warehouseTab === "STORE") base = storeItems;
    else if (warehouseTab === "NEW_ONLY") base = newOnlyItems;
    else if (warehouseTab === "NO_BIN") base = noBinItems;

    if (selectedLocation === "ALL") return base;
    return base.filter((i) => i.binLocation === selectedLocation);
  }, [warehouseTab, items, storeItems, newOnlyItems, noBinItems, selectedLocation]);

  // Unique location list for dropdown within the active warehouse view
  const uniqueLocations = useMemo(() => {
    let base = items;
    if (warehouseTab === "STORE") base = storeItems;
    else if (warehouseTab === "NEW_ONLY") base = newOnlyItems;
    else if (warehouseTab === "NO_BIN") base = noBinItems;

    const locSet = new Set(base.map((i) => i.binLocation));
    return Array.from(locSet);
  }, [warehouseTab, items, storeItems, newOnlyItems, noBinItems]);

  const handlePrint = () => {
    const now = new Date();
    const formattedTime = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      const htmlContent = generatePickListPrintHtml({
        items: displayedItems,
        formattedTime,
        warehouseTab,
        totalOrdersCount,
      });

      const printWindow = window.open("", "_blank", "width=1200,height=800");
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        return;
      }
    } catch (e) {
      console.warn("Popup print window failed, falling back to window.print():", e);
    }

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

    handlePrint();
  };

  // Reusable Table Section Component for each Warehouse Category
  const renderWarehouseTableSection = (title, categoryBadge, itemList, totalQty, headerBg, isStoreCategory) => {
    if (!itemList || itemList.length === 0) return null;

    return (
      <Card padding="0">
        <Box padding="300" background={headerBg}>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              {categoryBadge}
              <Text variant="headingSm" as="h3" fontWeight="bold">
                {title}
              </Text>
              <Badge tone="subdued">{`${itemList.length}종 품목`}</Badge>
            </InlineStack>

            <Text variant="bodySm" fontWeight="semibold">
              {`피킹 수량: 총 ${totalQty.toLocaleString()} 개 (레갈번호 오름차순 정렬)`}
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
            {itemList.map((item, idx) => {
              const itemWh = item.whInfo || parseWarehouseInfo(item.binLocation);

              return (
                <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  {/* 창고 위치 및 레갈 번호 셀 (오름차순) */}
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
  };

  return (
    <Page
      title="처리중 리스트"
      subtitle="매장창고와 신창고 구역별로 레갈번호 오름차순 정렬된 처리중 리스트를 제공합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={{
        content: "PDF 인쇄 및 이메일 전송",
        icon: PrintIcon,
        disabled: displayedItems.length === 0,
        onAction: handlePrintAndEmail,
      }}
      secondaryActions={[
        { content: "최신 주문 새로고침", onAction: () => revalidator.revalidate(), loading: revalidator.state !== "idle" },
        {
          content: "단순 인쇄 (A4 가로)",
          icon: PrintIcon,
          disabled: displayedItems.length === 0,
          onAction: handlePrint,
        },
      ]}
    >
      <BlockStack gap="400">
        <Text as="p" tone="subdued">조회 시각: {new Date(fetchedAt).toLocaleString("ko-KR", { timeZone: "Europe/Berlin" })} (베를린) · 온도 필터는 현재 조회 결과에 즉시 적용됩니다.</Text>
        {/* 인쇄 전용 스타일 */}
        <style>{`
          @media print {
            html, body, #app, .Polaris-Frame, .Polaris-Frame__Main, .Polaris-Frame__Content, .Polaris-Page, .Polaris-Page__Content, .Polaris-Box, .Polaris-BlockStack, .Polaris-Card, .Polaris-ShadowBevel {
              overflow: visible !important;
              height: auto !important;
              min-height: auto !important;
              max-height: none !important;
              position: static !important;
              display: block !important;
              background: #fff !important;
              color: #000 !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .Polaris-Page-Header, .Polaris-Banner, nav, header, button, .no-print {
              display: none !important;
            }
            @page {
              size: A4 landscape;
              margin: 8mm 6mm;
            }
            table {
              width: 100% !important;
              border-collapse: collapse !important;
              page-break-inside: auto !important;
              break-inside: auto !important;
            }
            tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            thead {
              display: table-header-group !important;
            }
            tfoot {
              display: table-footer-group !important;
            }
            th {
              background: #0f172a !important;
              color: #fff !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              padding: 6px 8px !important;
              font-size: 11px !important;
            }
            td {
              border-bottom: 1px solid #cbd5e1 !important;
              padding: 6px 8px !important;
              font-size: 11px !important;
            }
            .Polaris-Card {
              box-shadow: none !important;
              border: 1px solid #cbd5e1 !important;
              page-break-inside: auto !important;
              break-inside: auto !important;
              margin-bottom: 14px !important;
            }
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
                {noBinItems.length > 0 && (
                  <Button
                    pressed={warehouseTab === "NO_BIN"}
                    onClick={() => {
                      setWarehouseTab("NO_BIN");
                      setSelectedLocation("ALL");
                    }}
                  >
                    {`위치 미지정 [${noBinItems.length}종]`}
                  </Button>
                )}
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
                    label="구역 필터"
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
              매장창고와 신창고에 모두 재고가 있는 품목은 매장창고 테이블에 우선 배치되며 신창고 레갈 위치(신창고: OOO)가 함께 표시됩니다.
            </Text>
          </BlockStack>
        </Card>

        {/* 3. 매장창고 및 신창고 구분 테이블 렌더링 (레갈번호 오름차순) */}
        {displayedItems.length > 0 ? (
          <BlockStack gap="400">
            {/* 전체 뷰 또는 매장창고 탭 선택 시: 매장창고 테이블 */}
            {(warehouseTab === "ALL" || warehouseTab === "STORE") && (
              renderWarehouseTableSection(
                "매장창고 처리중 리스트 (STORE WAREHOUSE)",
                <Badge tone="info">매장창고</Badge>,
                selectedLocation === "ALL" ? storeItems : storeItems.filter((i) => i.binLocation === selectedLocation),
                selectedLocation === "ALL" ? storeQty : storeItems.filter((i) => i.binLocation === selectedLocation).reduce((sum, i) => sum + i.orderedQty, 0),
                "bg-surface-secondary",
                true
              )
            )}

            {/* 전체 뷰 또는 신창고 탭 선택 시: 신창고 전용 테이블 */}
            {(warehouseTab === "ALL" || warehouseTab === "NEW_ONLY") && (
              renderWarehouseTableSection(
                "신창고 전용 처리중 리스트 (NEW / MAIN WAREHOUSE)",
                <Badge tone="attention">신창고 전용</Badge>,
                selectedLocation === "ALL" ? newOnlyItems : newOnlyItems.filter((i) => i.binLocation === selectedLocation),
                selectedLocation === "ALL" ? newOnlyQty : newOnlyItems.filter((i) => i.binLocation === selectedLocation).reduce((sum, i) => sum + i.orderedQty, 0),
                "bg-surface-caution-subdued",
                false
              )
            )}

            {/* 전체 뷰 또는 위치 미지정 탭 선택 시: 위치 미지정 테이블 */}
            {(warehouseTab === "ALL" || warehouseTab === "NO_BIN") && noBinItems.length > 0 && (
              renderWarehouseTableSection(
                "위치 미지정 처리중 리스트 (UNASSIGNED LOCATION)",
                <Badge tone="warning">위치 미지정</Badge>,
                selectedLocation === "ALL" ? noBinItems : noBinItems.filter((i) => i.binLocation === selectedLocation),
                selectedLocation === "ALL" ? noBinQty : noBinItems.filter((i) => i.binLocation === selectedLocation).reduce((sum, i) => sum + i.orderedQty, 0),
                "bg-surface-warning-subdued",
                false
              )
            )}
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
export function ErrorBoundary() {
  return <Page title="처리중 리스트" backAction={{ content: '대시보드', url: '/app' }}><Banner tone="critical" title="주문 또는 창고 위치를 불러오지 못했습니다."><p>조회가 완료되지 않아 불완전한 목록은 표시하지 않습니다. 잠시 후 다시 시도해 주세요.</p><Button onClick={() => window.location.reload()}>다시 불러오기</Button></Banner></Page>;
}
