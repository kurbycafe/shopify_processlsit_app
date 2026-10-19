import { loadProcessingList } from "../services/pickListData.server.js";
import { memo, useCallback, useMemo, useState } from "react";
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
import { generatePickListPrintHtml } from "../utils/pickListPrintHtml";
import { parseWarehouseInfo, compareRegalAscending } from "../utils/warehouseHelpers.js";
import { fetchOdooBinLocations } from "../services/odooClient.server.js";
import AppEmptyState from "../components/common/AppEmptyState";
import MetricCard from "../components/common/MetricCard";
import { dispatchPickList } from "../services/pickListDispatch.js";

export { parseWarehouseInfo, compareRegalAscending };
const EMPTY_LIST = Object.freeze([]);

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tempFilter = url.searchParams.get("tempFilter") === "DRY_ONLY" ? "DRY_ONLY" : "ALL";
  const result = await loadProcessingList({ admin, fetchBins: skus => fetchOdooBinLocations(skus, { strict: true }) });
  const activeView = result?.views?.[tempFilter] || result?.views?.ALL || {};
  return {
    ...result,
    ...activeView,
    tempFilter,
  };
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
    try {
      const items = JSON.parse(formData.get("items") || "[]");
      const ordersPayload = JSON.parse(formData.get("ordersPayload") || "[]");
      const [{ generatePickListPdfBuffer }, { sendPickListEmailWithPdf }] = await Promise.all([
        import("../utils/pickListPrint.js"),
        import("../utils/emailService.js"),
      ]);
      return await dispatchPickList({
        shop: session.shop, items, orders: ordersPayload, clientTime, techTime,
      }, {
        db: prisma, generatePdf: generatePickListPdfBuffer, sendEmail: sendPickListEmailWithPdf,
      });
    } catch (err) {
      console.error("PDF dispatch failed:", err.message);
      return { success: false, error: `이메일 발송 실패: ${err.message}` };
    }
  }

  return null;
};

const PickListTableRow = memo(function PickListTableRow({ item }) {
  if (!item) return null;
  const itemWh = item.whInfo || parseWarehouseInfo(item.binLocation);
  const orderNums = Array.isArray(item.orderNumbers) ? item.orderNumbers : [];
  const orderCount = orderNums.length;
  const orderSummary =
    orderCount > 3
      ? `${orderNums.slice(0, 3).join(", ")} 외 ${orderCount - 3}건`
      : orderNums.join(", ");
  const invQty = item.inventoryQty;
  const invTone =
    typeof invQty === "number"
      ? invQty < 5
        ? "critical"
        : invQty < 10
        ? "warning"
        : undefined
      : undefined;

  const cellBg = itemWh.isNewOnly
    ? "#ecfeff"
    : itemWh.category === "NO_BIN"
    ? "#fffbeb"
    : "#eff6ff";

  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      {/* 창고 위치 및 레갈 번호 셀 (오름차순) */}
      <td style={{ padding: "10px 12px", backgroundColor: cellBg }}>
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
              {itemWh.storeShelf || itemWh.newShelf || item.binLocation || "위치 미지정"}
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
        {`${item.orderedQty ?? 0} 개`}
      </td>

      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {typeof invQty === "number" ? (
          <Text tone={invTone}>
            {`${invQty} 개`}
          </Text>
        ) : (
          "-"
        )}
      </td>

      <td style={{ padding: "10px 12px", fontSize: "11px", color: "#64748b" }}>
        {orderSummary}
      </td>
    </tr>
  );
});

const WarehouseTableSection = memo(function WarehouseTableSection({
  title,
  categoryBadge,
  itemList,
  totalQty,
  headerBg,
}) {
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
          {itemList.map((item, idx) => (
            <PickListTableRow key={item?.key || item?.sku || idx} item={item} />
          ))}
        </tbody>
      </table>
    </Card>
  );
});

export default function PickListPage() {
  const loaderData = useLoaderData() || {};
  const actionData = useActionData();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const tempFilter = searchParams.get('tempFilter') === 'DRY_ONLY' ? 'DRY_ONLY' : (loaderData.tempFilter === 'DRY_ONLY' ? 'DRY_ONLY' : 'ALL');

  // Support both new multi-view shape { views: { ALL, DRY_ONLY } } and flat { items, ordersList, ... }
  const currentView = loaderData.views?.[tempFilter]
    || (tempFilter === (loaderData.tempFilter || 'ALL') && Array.isArray(loaderData.items) ? loaderData : null)
    || loaderData.views?.ALL
    || (Array.isArray(loaderData.items) ? loaderData : null)
    || {};

  const items = Array.isArray(currentView.items) ? currentView.items : EMPTY_LIST;
  const ordersList = Array.isArray(currentView.ordersList) ? currentView.ordersList : EMPTY_LIST;
  const totalOrdersCount = currentView.totalOrdersCount ?? ordersList.length;
  const fetchedAt = loaderData.fetchedAt || new Date().toISOString();

  // Warehouse Tabs: "ALL" | "STORE" | "NEW_ONLY" | "NO_BIN"
  const [warehouseTab, setWarehouseTab] = useState("ALL");
  const [selectedLocation, setSelectedLocation] = useState("ALL");

  // Segregate and sort each warehouse category in ascending Regal order (server pre-computed when available)
  const { storeItems, newOnlyItems, noBinItems } = useMemo(() => {
    if (
      Array.isArray(currentView.storeItems) &&
      Array.isArray(currentView.newOnlyItems) &&
      Array.isArray(currentView.noBinItems)
    ) {
      return {
        storeItems: currentView.storeItems,
        newOnlyItems: currentView.newOnlyItems,
        noBinItems: currentView.noBinItems,
      };
    }

    const store = [];
    const newOnly = [];
    const noBin = [];

    (items || []).forEach((item) => {
      if (!item) return;
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
  }, [currentView.storeItems, currentView.newOnlyItems, currentView.noBinItems, items]);

  const storeQty = useMemo(() => {
    if (typeof currentView.storeQty === "number") return currentView.storeQty;
    return (storeItems || []).reduce((sum, i) => sum + (i?.orderedQty || 0), 0);
  }, [currentView.storeQty, storeItems]);

  const newOnlyQty = useMemo(() => {
    if (typeof currentView.newOnlyQty === "number") return currentView.newOnlyQty;
    return (newOnlyItems || []).reduce((sum, i) => sum + (i?.orderedQty || 0), 0);
  }, [currentView.newOnlyQty, newOnlyItems]);

  const noBinQty = useMemo(() => {
    if (typeof currentView.noBinQty === "number") return currentView.noBinQty;
    return (noBinItems || []).reduce((sum, i) => sum + (i?.orderedQty || 0), 0);
  }, [currentView.noBinQty, noBinItems]);

  // Tab-selected base items
  const activeBaseItems = useMemo(() => {
    if (warehouseTab === "STORE") return storeItems;
    if (warehouseTab === "NEW_ONLY") return newOnlyItems;
    if (warehouseTab === "NO_BIN") return noBinItems;
    return items;
  }, [warehouseTab, items, storeItems, newOnlyItems, noBinItems]);

  // Unique location list for dropdown within the active warehouse view
  const uniqueLocations = useMemo(() => {
    const locSet = new Set((activeBaseItems || []).map((i) => i?.binLocation).filter(Boolean));
    return Array.from(locSet);
  }, [activeBaseItems]);

  // Stable location options for Select
  const locationOptions = useMemo(() => {
    return [
      { label: `전체 구역 (${uniqueLocations.length})`, value: "ALL" },
      ...uniqueLocations.map((loc) => ({ label: loc, value: loc })),
    ];
  }, [uniqueLocations]);

  // Filtered lists and quantities for each warehouse category
  const {
    filteredStore,
    filteredStoreQty,
    filteredNewOnly,
    filteredNewOnlyQty,
    filteredNoBin,
    filteredNoBinQty,
  } = useMemo(() => {
    if (selectedLocation === "ALL") {
      return {
        filteredStore: storeItems,
        filteredStoreQty: storeQty,
        filteredNewOnly: newOnlyItems,
        filteredNewOnlyQty: newOnlyQty,
        filteredNoBin: noBinItems,
        filteredNoBinQty: noBinQty,
      };
    }

    const fStore = storeItems.filter((i) => i?.binLocation === selectedLocation);
    const fStoreQty = fStore.reduce((sum, i) => sum + (i?.orderedQty || 0), 0);

    const fNew = newOnlyItems.filter((i) => i?.binLocation === selectedLocation);
    const fNewQty = fNew.reduce((sum, i) => sum + (i?.orderedQty || 0), 0);

    const fNoBin = noBinItems.filter((i) => i?.binLocation === selectedLocation);
    const fNoBinQty = fNoBin.reduce((sum, i) => sum + (i?.orderedQty || 0), 0);

    return {
      filteredStore: fStore,
      filteredStoreQty: fStoreQty,
      filteredNewOnly: fNew,
      filteredNewOnlyQty: fNewQty,
      filteredNoBin: fNoBin,
      filteredNoBinQty: fNoBinQty,
    };
  }, [selectedLocation, storeItems, storeQty, newOnlyItems, newOnlyQty, noBinItems, noBinQty]);

  // Items to display based on selected warehouse tab and sub-location filter
  const displayedItems = useMemo(() => {
    if (warehouseTab === "STORE") return filteredStore;
    if (warehouseTab === "NEW_ONLY") return filteredNewOnly;
    if (warehouseTab === "NO_BIN") return filteredNoBin;

    if (selectedLocation === "ALL") return items;
    return items.filter((i) => i && i.binLocation === selectedLocation);
  }, [warehouseTab, selectedLocation, items, filteredStore, filteredNewOnly, filteredNoBin]);

  const handlePrint = useCallback(() => {
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
  }, [displayedItems, warehouseTab, totalOrdersCount]);

  const handlePrintAndEmail = useCallback(() => {
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
  }, [displayedItems, ordersList, submit, handlePrint]);

  const handleSelectTabAll = useCallback(() => {
    setWarehouseTab("ALL");
    setSelectedLocation("ALL");
  }, []);

  const handleSelectTabStore = useCallback(() => {
    setWarehouseTab("STORE");
    setSelectedLocation("ALL");
  }, []);

  const handleSelectTabNew = useCallback(() => {
    setWarehouseTab("NEW_ONLY");
    setSelectedLocation("ALL");
  }, []);

  const handleSelectTabNoBin = useCallback(() => {
    setWarehouseTab("NO_BIN");
    setSelectedLocation("ALL");
  }, []);

  const handleTempFilterChange = useCallback((val) => {
    searchParams.set("tempFilter", val);
    setSearchParams(searchParams);
  }, [searchParams, setSearchParams]);

  const handleRevalidate = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

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
        { content: "최신 주문 새로고침", onAction: handleRevalidate, loading: revalidator.state !== "idle" },
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
                  onClick={handleSelectTabAll}
                >
                  {`전체 목록 (${items.length}종)`}
                </Button>
                <Button
                  pressed={warehouseTab === "STORE"}
                  onClick={handleSelectTabStore}
                >
                  {`매장창고 피킹 (STORE) [${storeItems.length}종 / ${storeQty}개]`}
                </Button>
                <Button
                  pressed={warehouseTab === "NEW_ONLY"}
                  onClick={handleSelectTabNew}
                >
                  {`신창고 전용 피킹 (NEW WH) [${newOnlyItems.length}종 / ${newOnlyQty}개]`}
                </Button>
                {noBinItems.length > 0 && (
                  <Button
                    pressed={warehouseTab === "NO_BIN"}
                    onClick={handleSelectTabNoBin}
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
                  onChange={handleTempFilterChange}
                />

                {uniqueLocations.length > 1 && (
                  <Select
                    label="구역 필터"
                    labelInline
                    options={locationOptions}
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
              <WarehouseTableSection
                title="매장창고 처리중 리스트 (STORE WAREHOUSE)"
                categoryBadge={<Badge tone="info">매장창고</Badge>}
                itemList={filteredStore}
                totalQty={filteredStoreQty}
                headerBg="bg-surface-secondary"
              />
            )}

            {/* 전체 뷰 또는 신창고 탭 선택 시: 신창고 전용 테이블 */}
            {(warehouseTab === "ALL" || warehouseTab === "NEW_ONLY") && (
              <WarehouseTableSection
                title="신창고 전용 처리중 리스트 (NEW / MAIN WAREHOUSE)"
                categoryBadge={<Badge tone="attention">신창고 전용</Badge>}
                itemList={filteredNewOnly}
                totalQty={filteredNewOnlyQty}
                headerBg="bg-surface-caution-subdued"
              />
            )}

            {/* 전체 뷰 또는 위치 미지정 탭 선택 시: 위치 미지정 테이블 */}
            {(warehouseTab === "ALL" || warehouseTab === "NO_BIN") && noBinItems.length > 0 && (
              <WarehouseTableSection
                title="위치 미지정 처리중 리스트 (UNASSIGNED LOCATION)"
                categoryBadge={<Badge tone="warning">위치 미지정</Badge>}
                itemList={filteredNoBin}
                totalQty={filteredNoBinQty}
                headerBg="bg-surface-warning-subdued"
              />
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
