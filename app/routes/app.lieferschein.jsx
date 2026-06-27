import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import styles from "../styles/app.lieferschein.css?url";
import { Select, BlockStack, InlineStack, Card, Text, Box, TextField } from "@shopify/polaris";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

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
    const { admin } = await authenticate.admin(request);

    // ✨ 무한 페이지네이션을 위한 변수 설정
    let allEdges = [];
    let hasNextPage = true;
    let endCursor = null;

    // ✨ 다음 페이지가 없을 때까지(전체 미처리 주문을 다 가져올 때까지) 반복
    while (hasNextPage) {
      const response = await admin.graphql(`
        #graphql
        query getDawayoDetailedOrders($first: Int!, $after: String) {
          orders(
            first: $first,
            after: $after,
            query: "fulfillment_status:unfulfilled", # ✨ financial_status:paid 조건 삭제 (전체 로드)
            sortKey: CREATED_AT,
            reverse: true
          ) {
            pageInfo {
              hasNextPage
              endCursor
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
                displayFulfillmentStatus
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
        variables: {
          first: 50,
          after: endCursor
        }
      });

      const responseJson = await response.json();

      if (responseJson?.errors?.length > 0) {
        const errMsg = responseJson.errors.map((e) => e.message).join(", ");
        console.error("GraphQL errors:", errMsg);
        return jsonResponse({ orders: [], error: `GraphQL 오류: ${errMsg}` });
      }

      const connection = responseJson?.data?.orders;
      if (!connection) break;

      allEdges = allEdges.concat(connection.edges || []);
      hasNextPage = connection.pageInfo.hasNextPage;
      endCursor = connection.pageInfo.endCursor;
    }

    const validEdges = allEdges.filter((edge) => {
      const node = edge.node;
      if (node.cancelledAt) return false;
      const fStatus = node.displayFinancialStatus;
      if (fStatus === "REFUNDED" || fStatus === "VOIDED") return false;
      return true;
    });

    const orders = validEdges.map((edge) => {
      const node = edge.node;
      const shippingTitle = node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery";

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

        const titleKey = (item.title || "").replace(/["']/g, "").trim().toUpperCase();

        const weightValue = variant?.inventoryItem?.measurement?.weight?.value ?? 0;
        const weightUnit = variant?.inventoryItem?.measurement?.weight?.unit ?? "GRAMS";
        let grams = 0;
        if (weightUnit === "GRAMS") grams = weightValue;
        else if (weightUnit === "KILOGRAMS") grams = weightValue * 1000;
        else if (weightUnit === "POUNDS") grams = weightValue * 453.592;
        else if (weightUnit === "OUNCES") grams = weightValue * 28.3495;

        const variantGid = variant?.id || "";
        const isIcePackage = variantGid.endsWith("/54301230268745");
        const imageUrl = variant?.image?.url || variant?.image?.src || product?.featuredImage?.url || product?.featuredImage?.src || null;

        const priceOriginal = item.originalUnitPriceSet?.shopMoney?.amount || "0.00";
        const priceDiscounted = item.discountedUnitPriceSet?.shopMoney?.amount || "0.00";
        const totalOriginal = item.originalTotalSet?.shopMoney?.amount || "0.00";
        const totalDiscounted = item.discountedTotalSet?.shopMoney?.amount || "0.00";

        return {
          id: item.id,
          title: (item.title || "").replace(" - Default Title", ""),
          quantity: item.quantity || 0,
          sku: variant?.sku || "",
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

      const companyUpper = (node.shippingAddress?.company || "").toUpperCase();
      const nameUpper = (node.shippingAddress?.name || "").toUpperCase();
      const isB2B = !!(
        node.shippingAddress?.company ||
        companyUpper.includes("GMBH") ||
        nameUpper.includes("GMBH")
      );

      return {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
        createdTime: node.createdAt
          ? new Date(node.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
          : "-",
        email: node.email || "-",
        note: node.note || "",
        financialStatus: node.displayFinancialStatus || "UNKNOWN", // ✨ 필터링을 위해 결제 상태 저장
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
        totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
        subtotalPrice: node.subtotalPriceSet?.shopMoney?.amount || "0.00",
        totalTax: node.totalTaxSet?.shopMoney?.amount || "0.00",
        totalShipping: node.totalShippingPriceSet?.shopMoney?.amount || "0.00",
        totalDiscounts: node.totalDiscountsSet?.shopMoney?.amount || "0.00",
        currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
      };
    });

    // 🔍 합포장(Combined Shipping) 감지
    const emailCounts = {};
    orders.forEach((o) => {
      if (o.email && o.email !== "-") {
        emailCounts[o.email] = (emailCounts[o.email] || 0) + 1;
      }
    });

    const ordersWithCombinedInfo = orders.map((o) => ({
      ...o,
      hasCombinedShipping: o.email !== "-" && emailCounts[o.email] > 1,
      combinedCount: o.email !== "-" ? emailCounts[o.email] : 0,
    }));

    const orderIds = ordersWithCombinedInfo.map((o) => o.id);
    const printedRecords = await prisma.inspectionRecord.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, isLieferscheinPrinted: true, lieferscheinPrintedAt: true, isPickListPrinted: true }
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
        isPickListPrinted: dbRecord ? dbRecord.isPickListPrinted : false
      };
    });

    return jsonResponse({ orders: ordersWithPrintStatus, error: null });
  } catch (err) {
    console.error("Loader error:", err);
    return jsonResponse({ orders: [], error: err.message });
  }
};

// ─── 표준 Code 128B 바코드 엔진 ──────────────────────────────────────
const CODE128_CHARS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "11000111010"
];
const CODE128_START_B = 104;
const CODE128_STOP = "1100011101011";

function encodeCode128(text) {
  let checksum = CODE128_START_B;
  const bars = [CODE128_CHARS[CODE128_START_B]];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 94) continue;
    checksum += code * (i + 1);
    bars.push(CODE128_CHARS[code]);
  }
  bars.push(CODE128_CHARS[checksum % 103]);
  bars.push(CODE128_STOP);
  return bars.join("");
}

function Code128({ value, height = 36, moduleWidth = 1.1 }) {
  if (!value) return null;
  const encoded = encodeCode128(value);
  const quietZone = 6;
  const totalWidth = encoded.length * moduleWidth;

  let x = quietZone;
  const rects = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "1") {
      let w = 0;
      while (i < encoded.length && encoded[i] === "1") { w++; i++; }
      i--;
      rects.push(<rect key={x} x={x} y={0} width={w * moduleWidth} height={height} fill="#000" />);
      x += (w * moduleWidth);
    } else {
      let w = 0;
      while (i < encoded.length && encoded[i] === "0") { w++; i++; }
      i--;
      x += (w * moduleWidth);
    }
  }

  return (
    <div style={{ display: "block", textAlign: "center" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={totalWidth + quietZone * 2} height={height + 12} style={{ margin: "0 auto" }}>
        {rects}
        <text x={(totalWidth + quietZone * 2) / 2} y={height + 10} textAnchor="middle" fontSize="9" fontFamily="monospace" fontWeight="bold" fill="#111">
          {value}
        </text>
      </svg>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function AdditionalPage() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);

  // ✨ 필터 상태 관리 (State)
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [complexityFilter, setComplexityFilter] = useState("ALL");
  const [shippingFilter, setShippingFilter] = useState("ALL");
  const [printFilter, setPrintFilter] = useState("ALL"); // ✨ 인쇄 상태 필터 추가
  const [sortOrder, setSortOrder] = useState("DATE_DESC");
  const [searchQuery, setSearchQuery] = useState(""); // ✨ 검색 텍스트 필터 추가
  const [tempFilter, setTempFilter] = useState("ALL"); // ✨ 온도대 필터 추가

  useEffect(() => {
    if (loaderData?.orders) {
      setOrders(loaderData.orders); // ✨ DB의 isPrinted 상태 직접 활용
    }
  }, [loaderData]);

  // ✨ 주문 필터링 로직
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

    // 3. 배송 수단 필터
    if (shippingFilter === "STANDARD") {
      result = result.filter(o => {
        const method = o.shippingMethod.toUpperCase();
        return !method.includes("EXPRESS") && (method.includes("DHL") || method.includes("STANDARD"));
      });
    } else if (shippingFilter === "EXPRESS") {
      result = result.filter(o => o.shippingMethod.toUpperCase().includes("EXPRESS"));
    } else if (shippingFilter === "ICE") {
      result = result.filter(o => o.hasIcePackage);
    }

    // 3.5 인쇄 상태 필터
    if (printFilter === "UNPRINTED") {
      result = result.filter(o => !o.isPrinted);
    } else if (printFilter === "PRINTED") {
      result = result.filter(o => o.isPrinted);
    }

    // 3.6 온도대 필터 (Dry Only)
    if (tempFilter === "DRY_ONLY") {
      result = result.filter(o => o.isDryOnly);
    }

    // 3.8 검색 텍스트 필터
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q) ||
        (o.shippingAddress?.name && o.shippingAddress.name.toLowerCase().includes(q))
      );
    }

    // 4. 정렬 로직
    if (sortOrder === "QTY_ASC") {
      result.sort((a, b) => a.totalOrderQty - b.totalOrderQty);
    } else if (sortOrder === "QTY_DESC") {
      result.sort((a, b) => b.totalOrderQty - a.totalOrderQty);
    }

    return result;
  }, [orders, paymentFilter, regionFilter, complexityFilter, shippingFilter, printFilter, sortOrder, searchQuery, tempFilter]);

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

  return (
    <div>
      <div className="page-header">DAWAYO 패킹 시스템(개발중)</div>

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
                    onChange={setSearchQuery}
                    placeholder="예: #1001, service@dawayo.de, Soonchan"
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                  />
                </div>
              </div>

              <InlineStack gap="400" wrap={true}>
                {/* ✨ 결제 상태 필터 UI 추가 */}
                <Box minWidth="150px">
                  <Select
                    label="결제 상태"
                    options={[
                      { label: '전체 (Paid + Pending)', value: 'ALL' },
                      { label: '✅ 결제 완료 (Paid)', value: 'PAID' },
                      { label: '⏳ 결제 대기 (Pending)', value: 'PENDING' },
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
                    label="배송 수단 및 포장"
                    options={[
                      { label: '모든 수단', value: 'ALL' },
                      { label: '일반 배송 (Standard)', value: 'STANDARD' },
                      { label: '특급 배송 (Express)', value: 'EXPRESS' },
                      { label: '❄️ 냉장/냉동 포함', value: 'ICE' },
                    ]}
                    value={shippingFilter}
                    onChange={setShippingFilter}
                  />
                </Box>
                <Box minWidth="150px">
                  <Select
                    label="온도대 구분"
                    options={[
                      { label: '전체 온도대', value: 'ALL' },
                      { label: 'Dry Only (상온 제품만)', value: 'DRY_ONLY' },
                    ]}
                    value={tempFilter}
                    onChange={setTempFilter}
                  />
                </Box>
                {/* ✨ 인쇄 상태 필터 UI 추가 */}
                <Box minWidth="150px">
                  <Select
                    label="인쇄 상태"
                    options={[
                      { label: '모든 주문', value: 'ALL' },
                      { label: '⏳ 미출력 주문', value: 'UNPRINTED' },
                      { label: '✅ 출력 완료', value: 'PRINTED' },
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

        <table className="list-table">
          <thead>
            <tr>
              <th>주문 번호</th>
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
                <td colSpan="6" className="empty-orders-message">
                  조건에 맞는 주문이 없습니다.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isInternational = order.shippingAddress?.countryCode && order.shippingAddress.countryCode !== "DE";
                const isPaid = order.financialStatus === "PAID" || order.financialStatus === "PARTIALLY_PAID";

                return (
                  <tr key={order.id} className={order.isPrinted ? "row-printed" : ""}>
                    <td className="order-name">
                      <button
                        onClick={() => navigate(`/app/lieferschein/${order.id.split('/').pop()}`)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "#008060",
                          textDecoration: "underline",
                          cursor: "pointer",
                          fontWeight: "bold",
                          textAlign: "left"
                        }}
                      >
                        {order.name}
                      </button>
                    </td>

                    <td>
                      {isPaid ? (
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
                        {order.hasIcePackage && <span style={{ fontSize: "11px", background: "#bfdbfe", color: "#1e3a8a", padding: "2px 6px", borderRadius: "4px" }}>냉장</span>}
                        {order.isB2B && <span style={{ fontSize: "11px", background: "#dbeafe", color: "#1e40af", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>B2B</span>}
                        {order.hasCombinedShipping && (
                          <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                            ⚠️ 합포장 ({order.combinedCount}건)
                          </span>
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
      </div>
    </div>
  );
}