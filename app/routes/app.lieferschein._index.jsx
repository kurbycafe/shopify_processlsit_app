import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { authenticate, generatePrintToken } from "../shopify.server";
import prisma from "../db.server";

import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";
import styles from "../styles/app.lieferschein.css?url";
import { Select, BlockStack, InlineStack, Card, Text, Box, TextField, Pagination } from "@shopify/polaris";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

function checkIsB2B(shippingAddress) {
  if (!shippingAddress) return false;

  const company = (shippingAddress.company || "").trim();
  const name = (shippingAddress.name || "").trim();

  if (company) return true; // 회사명 필드가 입력된 경우 B2B로 판별

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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark_multiple_as_printed") {
    const payload = JSON.parse(formData.get("ordersPayload") || "[]");

    await Promise.all(
      payload.map((order) =>
        prisma.inspectionRecord.upsert({
          where: { orderId: order.id },
          update: { isLieferscheinPrinted: true, lieferscheinPrintedAt: new Date() },
          create: {
            orderId: order.id,
            orderName: order.name,
            shop: session.shop,
            status: "PENDING",
            isLieferscheinPrinted: true,
            lieferscheinPrintedAt: new Date(),
          },
        })
      )
    );

    return jsonResponse({ success: true });
  }

  if (intent === "reset_print_status") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName") || "N/A";

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

    return jsonResponse({ success: true });
  }

  return null;
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
    const limit = 100;

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
                totalPriceSet { shopMoney { amount currencyCode } }
                subtotalPriceSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                totalShippingPriceSet { shopMoney { amount currencyCode } }
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
                      title
                      name
                      sku
                      quantity
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                      discountedUnitPriceSet { shopMoney { amount currencyCode } }
                      originalTotalSet { shopMoney { amount currencyCode } }
                      discountedTotalSet { shopMoney { amount currencyCode } }
                      appliedDiscount {
                        title
                        description
                        value
                        valueType
                        amountSet { shopMoney { amount currencyCode } }
                      }
                      weight { value unit }
                      variant {
                        id
                        title
                        sku
                        barcode
                        inventoryItem {
                          measurement {
                            weight {
                              value
                              unit
                            }
                          }
                        }
                        image { url src } 
                        product {
                          featuredImage { url src } 
                          germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                          expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                          position: metafield(namespace: "custom", key: "position") { value }
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
                events(first: 10) {
                  edges {
                    node {
                      id
                      message
                      createdAt
                    }
                  }
                }
                displayFulfillmentStatus
                paymentGatewayNames
                customer {
                  numberOfOrders
                }
                totalPriceSet { shopMoney { amount currencyCode } }
                subtotalPriceSet { shopMoney { amount currencyCode } }
                totalTaxSet { shopMoney { amount currencyCode } }
                totalShippingPriceSet { shopMoney { amount currencyCode } }
                totalDiscountsSet { shopMoney { amount currencyCode } }
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
                      title
                      quantity
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                      discountedUnitPriceSet { shopMoney { amount currencyCode } }
                      originalTotalSet { shopMoney { amount currencyCode } }
                      discountedTotalSet { shopMoney { amount currencyCode } }
                      variant {
                        id
                        title
                        sku
                        barcode
                        inventoryItem {
                          measurement {
                            weight {
                              value
                              unit
                            }
                          }
                        }
                        image { url src } 
                        product {
                          featuredImage { url src } 
                          germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                          expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                          position: metafield(namespace: "custom", key: "position") { value }
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

      const rawItems = (node.lineItems?.edges || []).map((itemEdge) => {
        const item = itemEdge.node;
        const variant = item.variant;
        const product = variant?.product;

        const posRaw = product?.position?.value || "";
        const posUpper = posRaw.trim().toUpperCase();

        let sortKey = "500_" + posUpper;
        if (!posUpper) sortKey = "999_ZZZZZ";
        else if (posUpper.includes("!")) sortKey = "000_" + posUpper;
        else if (posUpper.includes("L-A")) sortKey = "100_" + posUpper;
        else if (posUpper.includes("L-B")) sortKey = "200_" + posUpper;
        else if (posUpper.includes("L-C")) sortKey = "300_" + posUpper;
        else if (posUpper.includes("L-D")) sortKey = "400_" + posUpper;

        const itemTitle = (item.title || item.name || "").replace(" - Default Title", "");
        const titleKey = itemTitle.replace(/["']/g, "").trim().toUpperCase();

        const weightValue = variant?.inventoryItem?.measurement?.weight?.value ?? item.weight?.value ?? 0;
        const weightUnit = variant?.inventoryItem?.measurement?.weight?.unit ?? item.weight?.unit ?? "GRAMS";
        let grams = 0;
        if (weightUnit === "GRAMS") grams = weightValue;
        else if (weightUnit === "KILOGRAMS") grams = weightValue * 1000;
        else if (weightUnit === "POUNDS") grams = weightValue * 453.592;
        else if (weightUnit === "OUNCES") grams = weightValue * 28.3495;

        const variantGid = variant?.id || "";
        const isIcePackage = variantGid.endsWith("/54301230268745");
        const imageUrl = variant?.image?.url || variant?.image?.src || item.image?.url || item.image?.src || product?.featuredImage?.url || product?.featuredImage?.src || null;

        const priceOriginal = item.originalUnitPriceSet?.shopMoney?.amount || "0.00";
        const priceDiscounted = item.discountedUnitPriceSet?.shopMoney?.amount || priceOriginal;
        const totalOriginal = item.originalTotalSet?.shopMoney?.amount || "0.00";
        const totalDiscounted = item.discountedTotalSet?.shopMoney?.amount || totalOriginal;

        return {
          id: item.id,
          title: itemTitle,
          quantity: item.quantity || 0,
          sku: item.sku || variant?.sku || "",
          weightKg: grams > 0 ? (grams / 1000).toFixed(3) : null,
          gramsTotal: grams * (item.quantity || 0),
          barcode: variant?.barcode || "",
          variantTitle: variant?.title === "Default Title" ? "" : (variant?.title || ""),
          imageUrl,
          isIcePackage,
          germanTranslation: product?.germanTranslation?.value || "",
          expiryDate: product?.expiryDate?.value || "",
          position: posRaw,
          productType: (product?.producttype?.value || "t").trim().toLowerCase(),
          _finalSortString: `${sortKey}___:::___${titleKey}`,
          priceOriginal,
          priceDiscounted,
          totalOriginal,
          totalDiscounted,
        };
      });

      const sortedItems = [...rawItems].sort((a, b) =>
        a._finalSortString.localeCompare(b._finalSortString)
      );
      const totalGrams = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
      const hasIcePackage = sortedItems.some((i) => i.isIcePackage);
      const totalOrderQty = sortedItems.reduce((acc, curr) => acc + curr.quantity, 0);

      const isDryOnly = sortedItems.every(item => item.productType === "t" || !item.productType);
      const hasChilled = sortedItems.some(item => item.productType === "k");
      const hasFrozen = sortedItems.some(item => item.productType === "tk");

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
        paymentGatewayNames: node.paymentGatewayNames || [],
        shippingMethod: shippingTitle,
        billingAddress: node.billingAddress || null,
        shippingAddress: node.shippingAddress || null,
        hasIcePackage,
        totalWeightKg: (totalGrams / 1000).toFixed(3),
        totalOrderQty,
        items: sortedItems,
        isFirstPurchase: (node.customer?.numberOfOrders ?? 0) === 1,
        isDryOnly,
        hasChilled,
        hasFrozen,
        isB2B,
        hasCancellationRequest,
        hasReturnRequest,
        isCustomerHold,
        cancelReason: detection.cancelReason || node.cancelReason || null,
        totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
        subtotalPrice: node.subtotalPriceSet?.shopMoney?.amount || "0.00",
        totalTax: node.totalTaxSet?.shopMoney?.amount || "0.00",
        totalShipping: node.totalShippingPriceSet?.shopMoney?.amount || "0.00",
        totalDiscounts: node.totalDiscountsSet?.shopMoney?.amount || "0.00",
        currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
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

  // 필터 상태 관리 (State)
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [complexityFilter, setComplexityFilter] = useState("ALL");
  const [printFilter, setPrintFilter] = useState("UNPRINTED"); // default 값 미출력
  const [sortOrder, setSortOrder] = useState("DATE_DESC");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("query") || "");
  const [tempFilter, setTempFilter] = useState("ALL");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);

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
    let result = [...orders];

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
      result = result.filter(o => o.items.length === 1 && o.totalOrderQty === 1);
    } else if (complexityFilter === "COMPLEX") {
      result = result.filter(o => o.items.length >= 15);
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
        const orderNameClean = o.name.toLowerCase().replace(/^#/, "");
        if (isDigitsOnly) {
          return orderNameClean === cleanQ;
        }
        return (
          orderNameClean === cleanQ ||
          o.name.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          (o.shippingAddress?.name && o.shippingAddress.name.toLowerCase().includes(q))
        );
      });
    }

    // 4. 정렬 로직
    if (sortOrder === "QTY_ASC") {
      result.sort((a, b) => a.totalOrderQty - b.totalOrderQty);
    } else if (sortOrder === "QTY_DESC") {
      result.sort((a, b) => b.totalOrderQty - a.totalOrderQty);
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
      <div className="error-container">
        <div className="error-box">
          <strong>오류 발생:</strong> {loaderData.error}
        </div>
      </div>
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
    if (selectedOrderIds.length === 0) return;

    const holdOrders = orders.filter(o => selectedOrderIds.includes(o.id) && o.isCustomerHold);
    if (holdOrders.length > 0) {
      const names = holdOrders.map(o => o.name).join(", ");
      const confirmed = window.confirm(`[주의] 선택한 주문 중 고객 취소/반품 요청건(${names})이 포함되어 있습니다.\n\n계속 인쇄하시겠습니까?`);
      if (!confirmed) return;
    }

    // Open printing detailed page in a new window/tab
    const idList = selectedOrderIds.map(id => {
      const o = orders.find(ord => ord.id === id);
      const numId = id.split("/").pop();
      return o?.isDraft ? `draft-${numId}` : numId;
    });
    const tokens = selectedOrderIds.map(id => {
      const o = orders.find(ord => ord.id === id);
      return o?.printToken || "";
    });
    window.open(`/print/lieferschein/${idList.join(",")}?shop=${shop}&tokens=${tokens.join(",")}`, "_blank");

    // Prepare payload to mark as printed
    const selectedPayload = filteredOrders
      .filter(o => selectedOrderIds.includes(o.id))
      .map(o => ({ id: o.id, name: o.name }));

    // Send action to mark as printed
    fetcher.submit(
      {
        intent: "mark_multiple_as_printed",
        ordersPayload: JSON.stringify(selectedPayload),
      },
      { method: "POST" }
    );

    // Update local state immediately for visual feedback
    setOrders(prevOrders =>
      prevOrders.map(order => {
        if (selectedOrderIds.includes(order.id)) {
          return {
            ...order,
            isPrinted: true,
            printedAt: new Date().toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })
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
                    onChange={setPaymentFilter}
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
                    onChange={setRegionFilter}
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
                    onChange={setComplexityFilter}
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
                    onChange={setTempFilter}
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
                    onChange={setPrintFilter}
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
                    onChange={setSortOrder}
                  />
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Box>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBlockStart: "20px", marginBlockEnd: "10px" }}>
          <div style={{ fontSize: "15px", color: "#1e293b", fontWeight: "bold" }}>
            {currentOrderType === "DRAFT_ORDERS" ? "주문 초안 목록" : "주문 목록"} (필터 결과: <span style={{ color: "#008060" }}>{filteredOrders.length}</span>건 / 전체: {orders.length}건)
          </div>
          {selectedOrderIds.length > 0 && (
            <button
              onClick={handleBulkPrint}
              style={{
                padding: "6px 12px",
                fontSize: "13px",
                borderRadius: "6px",
                border: "none",
                background: "#008060",
                color: "#ffffff",
                fontWeight: "bold",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
              }}
            >
              선택한 주문 인쇄 ({selectedOrderIds.length}건)
            </button>
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
                          to={order.isDraft ? `/app/lieferschein/draft-${order.id.split('/').pop()}` : `/app/lieferschein/${order.id.split('/').pop()}`}
                          style={{
                            color: order.isCustomerHold ? "#dc2626" : "#008060",
                            textDecoration: "underline",
                            fontWeight: "bold",
                          }}
                        >
                          {order.name}
                        </Link>
                        {order.isDraft && (
                          <span style={{
                            fontSize: "10px",
                            background: "#e0e7ff",
                            color: "#3730a3",
                            border: "1px solid #c7d2fe",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            display: "inline-block",
                            width: "fit-content"
                          }}>
                            초안 {order.draftStatus ? `(${order.draftStatus})` : ""}
                          </span>
                        )}
                        {order.isCustomerHold && (
                          <span style={{
                            fontSize: "11px",
                            background: "#fee2e2",
                            color: "#b91c1c",
                            border: "1px solid #f87171",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            display: "inline-block",
                            width: "fit-content"
                          }}>
                            {order.hasReturnRequest ? "반품 요청" : "취소 요청"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: "500" }}>{order.shippingAddress?.name || order.billingAddress?.name || "-"}</div>
                      {order.shippingAddress?.company && <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>{order.shippingAddress.company}</div>}
                    </td>

                    <td>
                      {order.isDraft ? (
                        <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                          {order.draftStatus === "COMPLETED" ? "주문완료" : order.draftStatus === "INVOICED" ? "청구서발송" : "초안대기"}
                        </span>
                      ) : isPaid ? (
                        <span style={{ fontSize: "11px", background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>결제완료</span>
                      ) : (
                        <span style={{ fontSize: "11px", background: "#fef08a", color: "#854d0e", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>{order.financialStatus}</span>
                      )}
                    </td>

                    <td>{order.createdAt}</td>
                    <td>
                      <strong>{order.items.length}</strong>종 / 총 <strong>{order.totalOrderQty}</strong>개
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {isInternational && <span style={{ fontSize: "11px", background: "#fef08a", color: "#854d0e", padding: "2px 6px", borderRadius: "4px" }}>해외</span>}
                        {(order.shippingMethod.toUpperCase().includes("EXPRESS") || order.shippingMethod.toUpperCase().includes("SAVER")) && (
                          <span style={{ fontSize: "11px", background: "#fecaca", color: "#991b1b", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>EXPRESS</span>
                        )}
                        {order.isB2B && <span style={{ fontSize: "11px", background: "#dbeafe", color: "#1e40af", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>B2B</span>}
                        {order.hasCombinedShipping && (
                          <span
                            title={`합포장 주문 목록: ${order.combinedOrderNames.join(", ")}`}
                            style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold", cursor: "help" }}
                          >
                            합포장 ({order.combinedCount}건: {order.combinedOrderNames.filter(name => name !== order.name).join(", ")})
                          </span>
                        )}
                        {order.isDryOnly ? (
                          <span style={{ fontSize: "11px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", padding: "2px 6px", borderRadius: "4px" }}>상온</span>
                        ) : (
                          <>
                            {order.hasChilled && (
                              <span style={{ fontSize: "11px", background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>냉장</span>
                            )}
                            {order.hasFrozen && (
                              <span style={{ fontSize: "11px", background: "#faf5ff", color: "#6b21a8", border: "1px solid #e9d5ff", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>냉동</span>
                            )}
                            {order.hasIcePackage && (
                              <span style={{ fontSize: "11px", background: "#ecfeff", color: "#0891b2", border: "1px solid #c5f2f7", padding: "2px 6px", borderRadius: "4px" }}>아이스팩</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      {order.isPrinted ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span className="status-badge-printed">인쇄 완료</span>
                            {order.printedAt && (
                              <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                                {order.printedAt}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleResetPrint(order.id, order.name)}
                            style={{
                              padding: "2px 6px",
                              fontSize: "11px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              background: "#f8fafc",
                              cursor: "pointer",
                              color: "#475569"
                            }}
                            className="no-print"
                          >
                            대기전환
                          </button>
                        </div>
                      ) : (
                        <span className="status-badge-ready">대기중</span>
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