import { normalizeProductType } from "../utils/productTemperatures.js";
import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { authenticate, generatePrintToken } from "../shopify.server";
import prisma from "../db.server";

import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";
import styles from "../styles/app.lieferschein.css?url";
import { Select, BlockStack, InlineStack, Card, Text, Box, TextField, Pagination, Button, Badge, Banner } from "@shopify/polaris";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

function checkIsB2B(shippingAddress) {
  if (!shippingAddress) return false;

  const company = String(shippingAddress.company || "").trim();
  const name = String(shippingAddress.name || "").trim();

  if (company) return true;

  const nameUpper = name.toUpperCase();
  const b2bPatterns = [
    /\bGMBH\b/,
    /\bUG\b/,
    /\bAG\b/,
    /\bGBR\b/,
    /\bOHG\b/,
    /\bKG\b/,
    /\bE\.K\b/,
    /\bLTD\b/,
    /\bINC\b/,
    /\bB\.V\.(?!\w)/,
    /\bS\.A\.(?!\w)/,
    /\bS\.A\.R\.L\.(?!\w)/
  ];

  return b2bPatterns.some(pattern => pattern.test(nameUpper));
}

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "mark_multiple_as_printed") {
      let payload = [];
      try {
        payload = JSON.parse(formData.get("ordersPayload") || "[]");
      } catch {
        payload = [];
      }

      if (Array.isArray(payload) && payload.length > 0) {
        const now = new Date();
        await Promise.all(
          payload.filter(o => o && o.id).map((order) =>
            prisma.inspectionRecord.upsert({
              where: { orderId: order.id },
              update: { isLieferscheinPrinted: true, lieferscheinPrintedAt: now },
              create: {
                orderId: order.id,
                orderName: order.name || "N/A",
                shop: session.shop,
                status: "PENDING",
                isLieferscheinPrinted: true,
                lieferscheinPrintedAt: now,
              },
            })
          )
        );
      }

      return jsonResponse({ success: true });
    }

    if (intent === "reset_print_status") {
      const orderId = formData.get("orderId");
      const orderName = formData.get("orderName") || "N/A";

      if (orderId) {
        await prisma.inspectionRecord.upsert({
          where: { orderId },
          update: { isLieferscheinPrinted: false, lieferscheinPrintedAt: null },
          create: {
            orderId,
            orderName,
            shop: session.shop,
            status: "PENDING",
            isLieferscheinPrinted: false,
            lieferscheinPrintedAt: null,
          },
        });
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Action error in lieferschein._index:", err);
    return jsonResponse({ success: false, error: err.message }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const queryParam = url.searchParams.get("query") || "";
    const orderType = url.searchParams.get("orderType") || "ORDERS";
    const isDraftMode = orderType === "DRAFT_ORDERS";

    let shopifyQuery = isDraftMode ? "status:open" : "fulfillment_status:unfulfilled status:open";
    if (queryParam) {
      const cleanQ = queryParam.trim().replace(/^#/, "");
      const isDigitsOnly = /^\d+$/.test(cleanQ);

      if (isDigitsOnly) {
        shopifyQuery = isDraftMode
          ? `(name:${cleanQ} OR name:#${cleanQ} OR name:D${cleanQ} OR name:#D${cleanQ}) status:any`
          : `(name:${cleanQ} OR name:#${cleanQ}) status:any`;
      } else {
        shopifyQuery = `${queryParam.trim()} status:any`;
      }
    }

    const after = url.searchParams.get("after") || null;
    const before = url.searchParams.get("before") || null;
    const parsedLimit = parseInt(url.searchParams.get("limit") || "100", 10);
    const limit = [30, 50, 100].includes(parsedLimit) ? parsedLimit : 100;

    const variables = {
      query: shopifyQuery || null,
    };

    if (before) {
      variables.last = limit;
      variables.before = before;
    } else {
      variables.first = limit;
      variables.after = after;
    }

    const response = isDraftMode
      ? await admin.graphql(`
        #graphql
        query getDawayoDetailedDraftOrders($first: Int, $last: Int, $after: String, $before: String, $query: String) {
          draftOrders(
            first: $first,
            last: $last,
            after: $after,
            before: $before,
            query: $query,
            sortKey: UPDATED_AT,
            reverse: true
          ) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              endCursor
              startCursor
            }
            edges {
              node {
                id
                name
                createdAt
                email
                note: note2
                status
                tags
                customer {
                  numberOfOrders
                }
                shippingLine {
                  title
                }
                billingAddress {
                  name company address1 address2 zip city country phone countryCode
                }
                shippingAddress {
                  name company address1 address2 zip city country phone countryCode
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      variant {
                        id
                        product {
                          producttype: metafield(namespace: "custom", key: "producttype") { value }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        variables
      })
      : await admin.graphql(`
        #graphql
        query getDawayoDetailedOrders($first: Int, $last: Int, $after: String, $before: String, $query: String) {
          orders(
            first: $first,
            last: $last,
            after: $after,
            before: $before,
            query: $query,
            sortKey: CREATED_AT,
            reverse: true
          ) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              endCursor
              startCursor
            }
            edges {
              node {
                id
                name
                createdAt
                email
                note
                displayFinancialStatus
                cancelledAt
                cancelReason
                returnStatus
                tags
                customer {
                  numberOfOrders
                }
                shippingLines(first: 1) {
                  edges {
                    node {
                      title
                    }
                  }
                }
                billingAddress {
                  name company address1 address2 zip city country phone countryCode
                }
                shippingAddress {
                  name company address1 address2 zip city country phone countryCode
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      variant {
                        id
                        product {
                          producttype: metafield(namespace: "custom", key: "producttype") { value }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        variables
      });

    const responseJson = await response.json();

    if (responseJson?.errors?.length > 0) {
      const errMsg = responseJson.errors.map((e) => e.message).join(", ");
      console.error("GraphQL errors:", errMsg);
      return jsonResponse({ orders: [], error: `GraphQL 오류: ${errMsg}`, orderType });
    }

    const connection = isDraftMode ? responseJson?.data?.draftOrders : responseJson?.data?.orders;
    if (!connection) {
      return jsonResponse({ orders: [], pageInfo: { hasNextPage: false, hasPreviousPage: false }, error: null, orderType });
    }

    const allEdges = connection.edges || [];
    const pageInfo = {
      hasNextPage: connection.pageInfo.hasNextPage,
      hasPreviousPage: connection.pageInfo.hasPreviousPage,
      startCursor: connection.pageInfo.startCursor,
      endCursor: connection.pageInfo.endCursor
    };

    const validEdges = allEdges.filter((edge) => {
      const node = edge.node;
      if (isDraftMode) {
        if (!queryParam && node.status === "COMPLETED") return false;
        return true;
      }
      // 검색어가 있을 때는 취소/환불건도 포함하여 보여줌 (과거 주문 조회용)
      if (!queryParam) {
        if (node.cancelledAt) return false;
        const fStatus = node.displayFinancialStatus;
        if (fStatus === "REFUNDED" || fStatus === "VOIDED") return false;
      }
      return true;
    });

    const orders = validEdges.map((edge) => {
      const node = edge.node;
      const shippingTitle = node.shippingLines?.edges?.[0]?.node?.title || node.shippingLine?.title || "Standard Delivery";

      let totalOrderQty = 0;
      let hasIcePackage = false;
      let isDryOnly = true;
      let hasChilled = false;
      let hasFrozen = false;

      const lineItemEdges = node.lineItems?.edges || [];
      const lineItemCount = lineItemEdges.length;

      if (lineItemCount === 0) {
        isDryOnly = false;
      }

      for (const itemEdge of lineItemEdges) {
        const item = itemEdge.node;
        const qty = item.quantity || 0;
        totalOrderQty += qty;

        const variantGid = item.variant?.id || "";
        if (variantGid.endsWith("/54301230268745")) {
          hasIcePackage = true;
        }

        const pType = normalizeProductType(item.variant?.product?.producttype?.value);
        if (pType === "k") {
          hasChilled = true;
          isDryOnly = false;
        } else if (pType === "tk") {
          hasFrozen = true;
          isDryOnly = false;
        } else if (pType !== "t") {
          isDryOnly = false;
        }
      }

      const detection = isDraftMode
        ? {
            hasCancellationRequest: false,
            hasReturnRequest: false,
            isCustomerHold: false,
            cancelReason: null,
          }
        : detectOrderCancellationStatus({
            cancelledAt: node.cancelledAt,
            cancelReason: node.cancelReason,
            returnStatus: node.returnStatus,
            tags: node.tags,
            events: (node.events?.edges || []).map((e) => e.node),
          });

      const hasCancellationRequest = detection.hasCancellationRequest;
      const hasReturnRequest = detection.hasReturnRequest;
      const isCustomerHold = detection.isCustomerHold;

      const isB2B = checkIsB2B(node.shippingAddress);

      return {
        id: node.id,
        isDraft: isDraftMode,
        draftStatus: node.status || null,
        name: node.name,
        createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
        createdTime: node.createdAt
          ? new Date(node.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
          : "-",
        email: node.email || "-",
        note: node.note || "",
        financialStatus: isDraftMode ? (node.status === "COMPLETED" ? "PAID" : "PENDING") : (node.displayFinancialStatus || "UNKNOWN"),
        shippingMethod: shippingTitle,
        billingAddress: node.billingAddress || null,
        shippingAddress: node.shippingAddress || null,
        hasIcePackage,
        totalOrderQty,
        items: new Array(lineItemCount).fill(null),
        isDryOnly,
        hasChilled,
        hasFrozen,
        isB2B,
        hasCancellationRequest,
        hasReturnRequest,
        isCustomerHold,
        cancelReason: detection.cancelReason || node.cancelReason || null,
      };
    });

    // 🔍 합포장(Combined Shipping) 감지 및 주문번호 수집
    const emailOrders = {};
    orders.forEach((o) => {
      if (o.email && o.email !== "-") {
        if (!emailOrders[o.email]) {
          emailOrders[o.email] = [];
        }
        emailOrders[o.email].push(o.name);
      }
    });

    const ordersWithCombinedInfo = orders.map((o) => ({
      ...o,
      hasCombinedShipping: o.email !== "-" && emailOrders[o.email]?.length > 1,
      combinedCount: o.email !== "-" ? emailOrders[o.email]?.length : 0,
      combinedOrderNames: o.email !== "-" ? emailOrders[o.email] : [],
    }));

    const orderIds = ordersWithCombinedInfo.map((o) => o.id);
    const printedRecords = await prisma.inspectionRecord.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, isLieferscheinPrinted: true, lieferscheinPrintedAt: true, isPickListPrinted: true, isCancelAlertSent: true }
    });

    const ordersWithPrintStatus = ordersWithCombinedInfo.map((order) => {
      const dbRecord = printedRecords.find((r) => r.orderId === order.id);

      let printedAtStr = null;
      if (dbRecord && dbRecord.lieferscheinPrintedAt) {
        printedAtStr = new Date(dbRecord.lieferscheinPrintedAt).toLocaleString("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
      }

      return {
        ...order,
        isPrinted: dbRecord ? dbRecord.isLieferscheinPrinted : false,
        printedAt: printedAtStr,
        isPickListPrinted: dbRecord ? dbRecord.isPickListPrinted : false,
        isCancelAlertSent: dbRecord ? dbRecord.isCancelAlertSent : false,
        printToken: generatePrintToken(order.id, session.shop),
      };
    });

    return jsonResponse({ orders: ordersWithPrintStatus, pageInfo, error: null, shop: session.shop, orderType });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Loader error:", err);
    return jsonResponse({ orders: [], error: err.message, orderType: "ORDERS" });
  }
};

export default function AdditionalPage() {
  const loaderData = useLoaderData();
  const shop = loaderData?.shop || "";
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentOrderType = searchParams.get("orderType") || "ORDERS";

  const [orders, setOrders] = useState([]);

  // 필터 상태 관리 (State) - URL Query 파라미터 동기화로 뒤로가기 시 필터 보존
  const [paymentFilter, setPaymentFilter] = useState(searchParams.get("payment") || "ALL");
  const [regionFilter, setRegionFilter] = useState(searchParams.get("region") || "ALL");
  const [complexityFilter, setComplexityFilter] = useState(searchParams.get("complexity") || "ALL");
  const [printFilter, setPrintFilter] = useState(searchParams.get("print") || "UNPRINTED");
  const [sortOrder, setSortOrder] = useState(searchParams.get("sort") || "DATE_DESC");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("query") || "");
  const [tempFilter, setTempFilter] = useState(searchParams.get("temp") || "ALL");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const pageSize = searchParams.get("limit") || "100";

  const updateUrlFilter = (key, value, defaultValue = "ALL") => {
    const params = new URLSearchParams(searchParams);
    if (value && value !== defaultValue) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };

  const handlePageSizeChange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === "100") {
      params.delete("limit");
    } else {
      params.set("limit", value);
    }
    params.delete("after");
    params.delete("before");
    setSelectedOrderIds([]);
    setSearchParams(params);
  };

  const handleOrderTypeChange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === "DRAFT_ORDERS") {
      params.set("orderType", "DRAFT_ORDERS");
    } else {
      params.delete("orderType");
    }
    params.delete("after");
    params.delete("before");
    setSelectedOrderIds([]);
    setSearchParams(params);
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("query", value);
    } else {
      params.delete("query");
    }
    params.delete("after");
    params.delete("before");
    setSearchParams(params);
  };

  useEffect(() => {
    if (loaderData?.orders) {
      setOrders(loaderData.orders); // DB의 isPrinted 상태 직접 활용
    }
  }, [loaderData]);

  // 주문 필터링 로직
  const filteredOrders = useMemo(() => {
    let result = Array.isArray(orders) ? [...orders] : [];

    // 0. 결제 상태 필터
    if (paymentFilter === "PAID") {
      result = result.filter(o => o.financialStatus === "PAID" || o.financialStatus === "PARTIALLY_PAID");
    } else if (paymentFilter === "PENDING") {
      result = result.filter(o => o.financialStatus !== "PAID" && o.financialStatus !== "PARTIALLY_PAID");
    }

    // 1. 지역 필터
    if (regionFilter === "DOMESTIC") {
      result = result.filter(o => o.shippingAddress?.countryCode === "DE" || o.shippingAddress?.country === "Germany");
    } else if (regionFilter === "INTERNATIONAL") {
      result = result.filter(o => o.shippingAddress?.countryCode !== "DE" && o.shippingAddress?.country !== "Germany");
    }

    // 2. 상품 및 수량 필터
    if (complexityFilter === "SINGLE") {
      result = result.filter(o => (o.items?.length || 0) === 1 && (o.totalOrderQty || 0) === 1);
    } else if (complexityFilter === "COMPLEX") {
      result = result.filter(o => (o.items?.length || 0) >= 15);
    }

    // 3.5 인쇄 상태 필터 (검색어가 입력된 경우 검색 대상이 숨겨지지 않도록 예외 처리)
    if (printFilter === "UNPRINTED" && !searchQuery.trim()) {
      result = result.filter(o => !o.isPrinted);
    } else if (printFilter === "PRINTED") {
      result = result.filter(o => o.isPrinted);
    }

    // 3.6 온도대 필터
    if (tempFilter === "DRY_ONLY") {
      result = result.filter(o => o.isDryOnly);
    } else if (tempFilter === "CHILLED") {
      result = result.filter(o => o.hasChilled);
    } else if (tempFilter === "FROZEN") {
      result = result.filter(o => o.hasFrozen);
    }

    // 3.8 검색 텍스트 필터
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const cleanQ = q.replace(/^#/, "");
      const isDigitsOnly = /^\d+$/.test(cleanQ);

      result = result.filter(o => {
        const orderNameClean = (o.name || "").toLowerCase().replace(/^#/, "");
        if (isDigitsOnly) {
          return orderNameClean === cleanQ;
        }
        return (
          orderNameClean === cleanQ ||
          (o.name || "").toLowerCase().includes(q) ||
          (o.email || "").toLowerCase().includes(q) ||
          ((o.shippingAddress?.name || "").toLowerCase().includes(q))
        );
      });
    }

    // 4. 정렬 로직
    if (sortOrder === "QTY_ASC") {
      result.sort((a, b) => (a.totalOrderQty || 0) - (b.totalOrderQty || 0));
    } else if (sortOrder === "QTY_DESC") {
      result.sort((a, b) => (b.totalOrderQty || 0) - (a.totalOrderQty || 0));
    }

    return result;
  }, [orders, paymentFilter, regionFilter, complexityFilter, printFilter, sortOrder, searchQuery, tempFilter]);

  const selectableOrders = useMemo(() => {
    return filteredOrders;
  }, [filteredOrders]);

  const isAllSelected = useMemo(() => {
    return selectableOrders.length > 0 && selectableOrders.every(o => selectedOrderIds.includes(o.id));
  }, [selectableOrders, selectedOrderIds]);

  if (loaderData?.error) {
    return (
      <Box padding="400">
        <Banner tone="critical" title="주문 목록을 불러오지 못했습니다">
          <p>{loaderData.error}</p>
        </Banner>
      </Box>
    );
  }

  const handleResetPrint = (orderId, orderName) => {
    fetcher.submit(
      {
        intent: "reset_print_status",
        orderId: orderId,
        orderName: orderName,
      },
      { method: "POST" }
    );

    // 로컬 상태 즉시 업데이트
    setOrders(prevOrders =>
      prevOrders.map(order =>
        order.id === orderId ? { ...order, isPrinted: false } : order
      )
    );
  };

  const handleBulkPrint = () => {
    if (!selectedOrderIds || selectedOrderIds.length === 0) return;

    if (selectedOrderIds.length > 100) {
      alert(`[PDF 인쇄 한도 안내]\n브라우저의 PDF 렌더러 메모리 초과 및 쇼피파이 통신 타임아웃을 방지하기 위해 1회 최대 인쇄 수량은 100건(권장 50건)으로 제한됩니다.\n\n현재 선택: ${selectedOrderIds.length}건\n\n100건 이하로 나누어 선택 후 출력해주세요.`);
      return;
    }

    const holdOrders = orders.filter(o => selectedOrderIds.includes(o.id) && o.isCustomerHold);
    if (holdOrders.length > 0) {
      const names = holdOrders.map(o => o.name).join(", ");
      const confirmed = window.confirm(`[주의] 선택한 주문 중 고객 취소/반품 요청건(${names})이 포함되어 있습니다.\n\n계속 인쇄하시겠습니까?`);
      if (!confirmed) return;
    }

    // Open printing detailed page in a new window/tab
    const validOrders = [];
    const idList = [];
    const tokens = [];

    for (const id of selectedOrderIds) {
      const o = orders.find(ord => ord.id === id);
      if (!o || !o.printToken) continue;
      const numId = id ? String(id).split("/").pop() : "";
      if (!numId) continue;
      idList.push(o.isDraft ? `draft-${numId}` : numId);
      tokens.push(o.printToken);
      validOrders.push(o);
    }

    if (idList.length === 0) {
      alert("출력할 수 있는 유효한 주문이 없습니다.");
      return;
    }

    const printUrl = `/print/lieferschein/${idList.join(",")}?shop=${encodeURIComponent(shop)}&tokens=${tokens.join(",")}`;
    const printWindow = window.open(printUrl, "_blank");

    if (!printWindow || printWindow.closed || typeof printWindow.closed === "undefined") {
      alert("브라우저 팝업이 차단되어 인쇄 창을 열지 못했습니다.\n주소창 우측에서 팝업 허용을 활성화한 후 다시 클릭해주세요.\n\n(인쇄 완료 처리는 취소되었습니다.)");
      return;
    }

    // Prepare payload to mark as printed ONLY for successfully launched valid orders
    const selectedPayload = validOrders.map(o => ({ id: o.id, name: o.name }));

    // Send action to mark as printed
    fetcher.submit(
      {
        intent: "mark_multiple_as_printed",
        ordersPayload: JSON.stringify(selectedPayload),
      },
      { method: "POST" }
    );

    const nowStr = new Date().toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    // Update local state immediately for visual feedback
    const validIdSet = new Set(validOrders.map(o => o.id));
    setOrders(prevOrders =>
      prevOrders.map(order => {
        if (validIdSet.has(order.id)) {
          return {
            ...order,
            isPrinted: true,
            printedAt: nowStr
          };
        }
        return order;
      })
    );

    // Clear selection
    setSelectedOrderIds([]);
  };

  return (
    <div>
      <div className="page-header">DAWAYO 패킹 시스템</div>

      <div className="admin-panel">
        <p className="admin-help-text">
          출력할 주문을 선택한 뒤 버튼을 클릭하면 인쇄 팝업이 활성화됩니다. 이미 출력된 내역은 체크박스가 비활성화됩니다.
        </p>

        <Box paddingBlockEnd="400">
          <Card background="bg-surface-secondary">
            <BlockStack gap="400">
              <Text variant="headingSm" as="h3">스마트 주문 필터링</Text>

              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", width: "100%" }}>
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <TextField
                    label="주문 번호, 고객 이메일, 수령인 이름 검색"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="예: #1001, service@dawayo.de, Soonchan"
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => handleSearchChange("")}
                  />
                </div>
              </div>

              <InlineStack gap="400" wrap={true}>
                <Box minWidth="160px">
                  <Select
                    label="주문 구분"
                    options={[
                      { label: '일반 주문 (Orders)', value: 'ORDERS' },
                      { label: '주문 초안 (Draft Orders)', value: 'DRAFT_ORDERS' },
                    ]}
                    value={currentOrderType}
                    onChange={handleOrderTypeChange}
                  />
                </Box>
                {/* 결제 상태 필터 UI 추가 */}
                <Box minWidth="150px">
                  <Select
                    label="결제 상태"
                    options={[
                      { label: '전체 (Paid + Pending)', value: 'ALL' },
                      { label: '결제 완료 (Paid)', value: 'PAID' },
                      { label: '결제 대기 (Pending)', value: 'PENDING' },
                    ]}
                    value={paymentFilter}
                    onChange={(val) => { setPaymentFilter(val); updateUrlFilter("payment", val, "ALL"); }}
                  />
                </Box>
                <Box minWidth="150px">
                  <Select
                    label="국가 및 지역"
                    options={[
                      { label: '모든 배송지', value: 'ALL' },
                      { label: '독일 국내만 (Domestic)', value: 'DOMESTIC' },
                      { label: '해외 배송만 (International)', value: 'INTERNATIONAL' },
                    ]}
                    value={regionFilter}
                    onChange={(val) => { setRegionFilter(val); updateUrlFilter("region", val, "ALL"); }}
                  />
                </Box>
                <Box minWidth="160px">
                  <Select
                    label="상품 종류 및 복잡도"
                    options={[
                      { label: '모든 주문', value: 'ALL' },
                      { label: '단일 상품 (초스피드)', value: 'SINGLE' },
                      { label: '다품종 대량 (15종↑)', value: 'COMPLEX' },
                    ]}
                    value={complexityFilter}
                    onChange={(val) => { setComplexityFilter(val); updateUrlFilter("complexity", val, "ALL"); }}
                  />
                </Box>
                <Box minWidth="150px">
                  <Select
                    label="온도대 구분"
                    options={[
                      { label: '전체 온도대', value: 'ALL' },
                      { label: '상온 전용 (Dry Only)', value: 'DRY_ONLY' },
                      { label: '냉장 포함 (Chilled)', value: 'CHILLED' },
                      { label: '냉동 포함 (Frozen)', value: 'FROZEN' },
                    ]}
                    value={tempFilter}
                    onChange={(val) => { setTempFilter(val); updateUrlFilter("temp", val, "ALL"); }}
                  />
                </Box>
                {/* 인쇄 상태 필터 UI 추가 */}
                <Box minWidth="150px">
                  <Select
                    label="인쇄 상태"
                    options={[
                      { label: '모든 주문', value: 'ALL' },
                      { label: '미출력 주문', value: 'UNPRINTED' },
                      { label: '출력 완료', value: 'PRINTED' },
                    ]}
                    value={printFilter}
                    onChange={(val) => { setPrintFilter(val); updateUrlFilter("print", val, "UNPRINTED"); }}
                  />
                </Box>
                <Box minWidth="140px">
                  <Select
                    label="정렬 기준"
                    options={[
                      { label: '최신 주문순', value: 'DATE_DESC' },
                      { label: '수량 적은 순', value: 'QTY_ASC' },
                      { label: '수량 많은 순', value: 'QTY_DESC' },
                    ]}
                    value={sortOrder}
                    onChange={(val) => { setSortOrder(val); updateUrlFilter("sort", val, "DATE_DESC"); }}
                  />
                </Box>
                <Box minWidth="130px">
                  <Select
                    label="표시 개수"
                    options={[
                      { label: '100개씩 (기본 - 당일 전체)', value: '100' },
                      { label: '50개씩 (안정 분할 인쇄)', value: '50' },
                      { label: '30개씩 (초고속)', value: '30' },
                    ]}
                    value={pageSize}
                    onChange={handlePageSizeChange}
                  />
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Box>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBlockStart: "20px", marginBlockEnd: "10px" }}>
          <Text variant="headingSm" as="h2">
            {currentOrderType === "DRAFT_ORDERS" ? "주문 초안 목록" : "주문 목록"}{" "}
            <Text as="span" tone="subdued">
              (필터 결과: {filteredOrders.length}건 / 전체: {orders.length}건)
            </Text>
          </Text>
          {selectedOrderIds.length > 0 && (
            <Button
              variant="primary"
              onClick={handleBulkPrint}
            >
              선택한 주문 인쇄 ({selectedOrderIds.length}건)
            </Button>
          )}
        </div>

        <table className="list-table">
          <thead>
            <tr>
              <th style={{ width: "56px", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", justifyContent: "center" }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedOrderIds(selectableOrders.map(o => o.id));
                      } else {
                        setSelectedOrderIds([]);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b" }}>선택</span>
                </div>
              </th>
              <th>주문 번호</th>
              <th>고객명</th>
              <th>결제 상태</th>
              <th>날짜</th>
              <th>상품 종류 / 수량</th>
              <th>배송 및 조건</th>
              <th>인쇄 기록</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-orders-message">
                  조건에 맞는 주문이 없습니다.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isInternational = order.shippingAddress?.countryCode && order.shippingAddress.countryCode !== "DE";
                const isPaid = order.financialStatus === "PAID" || order.financialStatus === "PARTIALLY_PAID";

                return (
                  <tr key={order.id} className={order.isPrinted ? "row-printed" : ""}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(order.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOrderIds(prev => [...prev, order.id]);
                          } else {
                            setSelectedOrderIds(prev => prev.filter(id => id !== order.id));
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td className="order-name">
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <Link
                          to={order.isDraft ? `/app/lieferschein/draft-${order.id ? String(order.id).split('/').pop() : ''}` : `/app/lieferschein/${order.id ? String(order.id).split('/').pop() : ''}`}
                          style={{
                            color: order.isCustomerHold ? "#d72c0d" : "#005bd3",
                            textDecoration: "underline",
                            fontWeight: "600",
                          }}
                        >
                          {order.name}
                        </Link>
                        {order.isDraft && (
                          <Badge tone="info">초안 {order.draftStatus ? `(${order.draftStatus})` : ""}</Badge>
                        )}
                        {order.isCustomerHold && (
                          <Badge tone="critical">{order.hasReturnRequest ? "반품 요청" : "취소 요청"}</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: "500" }}>{order.shippingAddress?.name || order.billingAddress?.name || "-"}</div>
                      {order.shippingAddress?.company && <div style={{ fontSize: "11px", color: "#6d7175", marginTop: "2px" }}>{order.shippingAddress.company}</div>}
                    </td>

                    <td>
                      {order.isDraft ? (
                        <Badge tone="attention">
                          {order.draftStatus === "COMPLETED" ? "주문완료" : order.draftStatus === "INVOICED" ? "청구서발송" : "초안대기"}
                        </Badge>
                      ) : isPaid ? (
                        <Badge tone="success">결제완료</Badge>
                      ) : (
                        <Badge tone="attention">{order.financialStatus || "대기"}</Badge>
                      )}
                    </td>

                    <td>{order.createdAt || "-"}</td>
                    <td>
                      <strong>{order.items?.length || 0}</strong>종 / 총 <strong>{order.totalOrderQty || 0}</strong>개
                    </td>
                    <td>
                      <InlineStack gap="100" wrap={true}>
                        {isInternational && <Badge tone="attention">해외</Badge>}
                        {(order.shippingMethod && (order.shippingMethod.toUpperCase().includes("EXPRESS") || order.shippingMethod.toUpperCase().includes("SAVER"))) && (
                          <Badge tone="critical">EXPRESS</Badge>
                        )}
                        {order.isB2B && <Badge tone="info">B2B</Badge>}
                        {order.hasCombinedShipping && (
                          <span title={`합포장 주문 목록: ${(order.combinedOrderNames || []).join(", ")}`}>
                            <Badge tone="warning">합포장 ({order.combinedCount}건)</Badge>
                          </span>
                        )}
                        {order.isDryOnly ? (
                          <Badge tone="success">상온</Badge>
                        ) : (
                          <>
                            {order.hasChilled && <Badge tone="info">냉장</Badge>}
                            {order.hasFrozen && <Badge tone="attention">냉동</Badge>}
                            {order.hasIcePackage && <Badge tone="subdued">아이스팩</Badge>}
                          </>
                        )}
                      </InlineStack>
                    </td>
                    <td>
                      {order.isPrinted ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <Badge tone="subdued">인쇄 완료</Badge>
                            {order.printedAt && (
                              <span style={{ fontSize: "10px", color: "#6d7175", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                                {order.printedAt}
                              </span>
                            )}
                          </div>
                          <Button
                            size="micro"
                            onClick={() => handleResetPrint(order.id, order.name)}
                          >
                            대기전환
                          </Button>
                        </div>
                      ) : (
                        <Badge tone="new">대기중</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {loaderData?.pageInfo && (loaderData.pageInfo.hasNextPage || loaderData.pageInfo.hasPreviousPage) && (
          <div style={{ display: "flex", justifyContent: "center", marginBlockStart: "20px", marginBlockEnd: "10px" }}>
            <Pagination
              hasPrevious={loaderData.pageInfo.hasPreviousPage}
              onPrevious={() => {
                const params = new URLSearchParams(searchParams);
                if (loaderData.pageInfo.startCursor) {
                  params.set("before", loaderData.pageInfo.startCursor);
                  params.delete("after");
                  setSearchParams(params);
                }
              }}
              hasNext={loaderData.pageInfo.hasNextPage}
              onNext={() => {
                const params = new URLSearchParams(searchParams);
                if (loaderData.pageInfo.endCursor) {
                  params.set("after", loaderData.pageInfo.endCursor);
                  params.delete("before");
                  setSearchParams(params);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}