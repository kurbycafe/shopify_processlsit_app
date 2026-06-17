import { useLoaderData, useFetcher } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import styles from "../styles/app.lieferschein.css?url"; 
import { Select, BlockStack, InlineStack, Card, Text, Box } from "@shopify/polaris";

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
          update: { isLieferscheinPrinted: true },
          create: {
            orderId: order.id,
            orderName: order.name,
            shop: session.shop,
            status: "PENDING",
            isLieferscheinPrinted: true,
          },
        })
      )
    );

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
                displayFulfillmentStatus
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

    const orders = allEdges.map((edge) => {
      const node = edge.node;
      const shippingTitle = node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery";

      const rawItems = (node.lineItems?.edges || []).map((itemEdge) => {
        const item = itemEdge.node;
        const variant = item.variant;
        const product = variant?.product;

        const posRaw = product?.position?.value || "";
        const posUpper = posRaw.trim().toUpperCase();

        let sortKey = "500_" + posUpper;
        if (!posUpper)                  sortKey = "999_ZZZZZ";
        else if (posUpper.includes("!"))    sortKey = "000_" + posUpper;
        else if (posUpper.includes("L-A"))  sortKey = "100_" + posUpper;
        else if (posUpper.includes("L-B"))  sortKey = "200_" + posUpper;
        else if (posUpper.includes("L-C"))  sortKey = "300_" + posUpper;
        else if (posUpper.includes("L-D"))  sortKey = "400_" + posUpper;

        const titleKey = (item.title || "").replace(/["']/g, "").trim().toUpperCase();

        const weightValue = variant?.inventoryItem?.measurement?.weight?.value ?? 0;
        const weightUnit  = variant?.inventoryItem?.measurement?.weight?.unit  ?? "GRAMS";
        let grams = 0;
        if      (weightUnit === "GRAMS")     grams = weightValue;
        else if (weightUnit === "KILOGRAMS") grams = weightValue * 1000;
        else if (weightUnit === "POUNDS")    grams = weightValue * 453.592;
        else if (weightUnit === "OUNCES")    grams = weightValue * 28.3495;

        const variantGid = variant?.id || "";
        const isIcePackage = variantGid.endsWith("/54301230268745");
        const imageUrl = variant?.image?.url || variant?.image?.src || product?.featuredImage?.url || product?.featuredImage?.src || null;

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
          _finalSortString: `${sortKey}___:::___${titleKey}`,
        };
      });

      const sortedItems = [...rawItems].sort((a, b) =>
        a._finalSortString.localeCompare(b._finalSortString)
      );
      const totalGrams    = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
      const hasIcePackage = sortedItems.some((i) => i.isIcePackage);
      const totalOrderQty = sortedItems.reduce((acc, curr) => acc + curr.quantity, 0);

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
      };
    });

    return jsonResponse({ orders, error: null });
  } catch (err) {
    console.error("Loader error:", err);
    return jsonResponse({ orders: [], error: err.message });
  }
};

// ─── 표준 Code 128B 바코드 엔진 ──────────────────────────────────────
const CODE128_CHARS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","11000111010"
];
const CODE128_START_B = 104;
const CODE128_STOP    = "1100011101011";

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
  
  const [orders, setOrders] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [printedOrderIds, setPrintedOrderIds] = useState([]);

  // ✨ 필터 상태 관리 (State)
  const [paymentFilter, setPaymentFilter] = useState("ALL"); // ✨ 결제 필터 추가
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [complexityFilter, setComplexityFilter] = useState("ALL");
  const [shippingFilter, setShippingFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState("DATE_DESC");

  useEffect(() => {
    if (loaderData?.orders) {
      setOrders(loaderData.orders.map(o => ({...o, isPrinted: false})));
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

    // 4. 정렬 로직
    if (sortOrder === "QTY_ASC") {
      result.sort((a, b) => a.totalOrderQty - b.totalOrderQty);
    } else if (sortOrder === "QTY_DESC") {
      result.sort((a, b) => b.totalOrderQty - a.totalOrderQty);
    }

    return result;
  }, [orders, paymentFilter, regionFilter, complexityFilter, shippingFilter, sortOrder]);

  useEffect(() => {
    setSelectedOrders([]);
  }, [filteredOrders]);


  if (loaderData?.error) {
    return (
      <div className="error-container">
        <div className="error-box">
          <strong>오류 발생:</strong> {loaderData.error}
        </div>
      </div>
    );
  }

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedOrders(filteredOrders.filter(o => !o.isPrinted).map((o) => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const handleSelectOrder = (id, checked) => {
    setSelectedOrders((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    );
  };

  const handlePrint = async () => {
    if (selectedOrders.length === 0) return;
    
    const ordersPayload = selectedOrders.map((id) => {
      const order = orders.find((o) => o.id === id);
      return { id, name: order?.name || "" };
    });

    fetcher.submit(
      {
        intent: "mark_multiple_as_printed",
        ordersPayload: JSON.stringify(ordersPayload),
      },
      { method: "POST" }
    );

    setPrintedOrderIds(prev => [...prev, ...selectedOrders]);
    setOrders(prevOrders =>
      prevOrders.map(order =>
        selectedOrders.includes(order.id) ? { ...order, isPrinted: true } : order
      )
    );
    setSelectedOrders([]);
    
    setTimeout(() => {
      window.print();
    }, 1200);
  };

  const activePrintOrders = orders.filter((o) => printedOrderIds.includes(o.id));

  return (
    <div>
      <div className="page-header">DAWAYO 패킹 시스템(개발중 - 출고용 사용금지)</div>

      <div className="admin-panel">
        <p className="admin-help-text">
          출력할 주문을 선택한 뒤 버튼을 클릭하면 인쇄 팝업이 활성화됩니다. 이미 출력된 내역은 체크박스가 비활성화됩니다.
        </p>

        <Box paddingBlockEnd="400">
          <Card background="bg-surface-secondary">
            <BlockStack gap="400">
              <Text variant="headingSm" as="h3">스마트 주문 필터링</Text>
              <InlineStack gap="400" wrap={true}>
                {/* ✨ 결제 상태 필터 UI 추가 */}
                <Box minWidth="150px">
                  <Select
                    label="결제 상태"
                    options={[
                      {label: '전체 (Paid + Pending)', value: 'ALL'},
                      {label: '✅ 결제 완료 (Paid)', value: 'PAID'},
                      {label: '⏳ 결제 대기 (Pending)', value: 'PENDING'},
                    ]}
                    value={paymentFilter}
                    onChange={setPaymentFilter}
                  />
                </Box>
                <Box minWidth="150px">
                  <Select
                    label="국가 및 지역"
                    options={[
                      {label: '모든 배송지', value: 'ALL'},
                      {label: '독일 국내만 (Domestic)', value: 'DOMESTIC'},
                      {label: '해외 배송만 (International)', value: 'INTERNATIONAL'},
                    ]}
                    value={regionFilter}
                    onChange={setRegionFilter}
                  />
                </Box>
                <Box minWidth="160px">
                  <Select
                    label="상품 종류 및 복잡도"
                    options={[
                      {label: '모든 주문', value: 'ALL'},
                      {label: '단일 상품 (초스피드)', value: 'SINGLE'},
                      {label: '다품종 대량 (15종↑)', value: 'COMPLEX'},
                    ]}
                    value={complexityFilter}
                    onChange={setComplexityFilter}
                  />
                </Box>
                <Box minWidth="150px">
                  <Select
                    label="배송 수단 및 포장"
                    options={[
                      {label: '모든 수단', value: 'ALL'},
                      {label: '일반 배송 (Standard)', value: 'STANDARD'},
                      {label: '특급 배송 (Express)', value: 'EXPRESS'},
                      {label: '❄️ 냉장/냉동 포함', value: 'ICE'},
                    ]}
                    value={shippingFilter}
                    onChange={setShippingFilter}
                  />
                </Box>
                <Box minWidth="140px">
                  <Select
                    label="정렬 기준"
                    options={[
                      {label: '최신 주문순', value: 'DATE_DESC'},
                      {label: '수량 적은 순', value: 'QTY_ASC'},
                      {label: '수량 많은 순', value: 'QTY_DESC'},
                    ]}
                    value={sortOrder}
                    onChange={setSortOrder}
                  />
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Box>

        <div className="print-action-row">
          <button className="print-btn" onClick={handlePrint} disabled={selectedOrders.length === 0}>
            선택 항목 패킹슬립 인쇄하기 ({selectedOrders.length}개)
          </button>
        </div>

        <table className="list-table">
          <thead>
            <tr>
              <th className="list-table-select-col">
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={filteredOrders.filter(o => !o.isPrinted).length > 0 && selectedOrders.length === filteredOrders.filter(o => !o.isPrinted).length}
                />
              </th>
              <th>주문 번호</th>
              <th>결제 상태</th> {/* ✨ 헤더 추가 */}
              <th>날짜</th>
              <th>상품 종류 / 수량</th>
              <th>배송 및 조건</th>
              <th>인쇄 기록</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-orders-message">
                  조건에 맞는 주문이 없습니다.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isInternational = order.shippingAddress?.countryCode && order.shippingAddress.countryCode !== "DE";
                const isPaid = order.financialStatus === "PAID" || order.financialStatus === "PARTIALLY_PAID";
                
                return (
                  <tr key={order.id} className={order.isPrinted ? "row-printed" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedOrders.includes(order.id)}
                        disabled={order.isPrinted}
                        onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                      />
                    </td>
                    <td className="order-name">{order.name}</td>
                    
                    {/* ✨ 결제 상태 뱃지 출력 */}
                    <td>
                      {isPaid ? (
                        <span style={{fontSize:"11px", background:"#dcfce7", color:"#166534", padding:"2px 6px", borderRadius:"4px", fontWeight:"bold"}}>결제완료</span>
                      ) : (
                        <span style={{fontSize:"11px", background:"#fef08a", color:"#854d0e", padding:"2px 6px", borderRadius:"4px", fontWeight:"bold"}}>{order.financialStatus}</span>
                      )}
                    </td>

                    <td>{order.createdAt}</td>
                    <td>
                      <strong>{order.items.length}</strong>종 / 총 <strong>{order.totalOrderQty}</strong>개
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {isInternational && <span style={{fontSize:"11px", background:"#fef08a", color:"#854d0e", padding:"2px 6px", borderRadius:"4px"}}>해외</span>}
                        {order.shippingMethod.toUpperCase().includes("EXPRESS") && <span style={{fontSize:"11px", background:"#fecaca", color:"#991b1b", padding:"2px 6px", borderRadius:"4px"}}>EXPRESS</span>}
                        {order.hasIcePackage && <span style={{fontSize:"11px", background:"#bfdbfe", color:"#1e3a8a", padding:"2px 6px", borderRadius:"4px"}}>냉장</span>}
                      </div>
                    </td>
                    <td>
                      {order.isPrinted ? (
                        <span className="status-badge-printed">인쇄 완료</span>
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

      {activePrintOrders.length > 0 && (
        <div className="paper-viewport">
          {activePrintOrders.map((order) => {
            const isInternational = order.shippingAddress?.country && 
              order.shippingAddress.country !== "Germany" && 
              order.shippingAddress.countryCode !== "DE";

            const methodUpper = order.shippingMethod.toUpperCase();
            let shippingBadgeText = null;
            if (methodUpper.includes("DHL")) {
              shippingBadgeText = "DHL Standard";
            } else if (methodUpper.includes("UPS EXPRESS SAVER")) {
              shippingBadgeText = "UPS Express Saver";
            } else if (methodUpper.includes("UPS EXPRESS")) {
              shippingBadgeText = "UPS Express";
            } else if (methodUpper.includes("UPS STANDARD")) {
              shippingBadgeText = "UPS Standard";
            }

            return (
              <div key={order.id} className="packing-slip">
                <div className="header">
                  <div className="header-left">
                    <div className="document-title">Lieferschein</div>
                    <table className="info-grid">
                      <tbody>
                        <tr><td className="info-label">Bestellnummer</td><td className="info-value">{order.name}</td></tr>
                        <tr><td className="info-label">Bestelldatum</td><td className="info-value">{order.createdAt}</td></tr>
                        <tr><td className="info-label">Bestellzeit</td><td className="info-value">{order.createdTime} Uhr</td></tr>
                        <tr><td className="info-label">Versandart</td><td className="info-value">{order.shippingMethod}</td></tr>
                        <tr><td className="info-label">E-Mail</td><td className="info-value">{order.email}</td></tr>
                        <tr><td className="info-label">Gesamtgewicht</td><td className="info-value">{order.totalWeightKg} kg</td></tr>
                      </tbody>
                    </table>
                    <div className="badges-row">
                      {order.shippingAddress?.company && <div className="badge">B2B</div>}
                      {order.hasIcePackage && <div className="badge badge-ice">❄ Kühlversand</div>}
                    </div>
                    {isInternational && (
                      <div className="international-box">
                        {order.shippingAddress.country.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="header-right">
                    <img className="logo" src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839" alt="DAWAYO" />
                    <div className="barcode-wrapper">
                      <div className="barcode-title">Order Barcode</div>
                      <Code128 value={order.name} height={38} moduleWidth={1.2} />
                    </div>
                    {shippingBadgeText && (
                      <div className="shipping-badge">{shippingBadgeText}</div>
                    )}
                  </div>
                </div>

                <div className="address-row">
                  <div className="address-box">
                    <div className="section-title">Rechnungsadresse</div>
                    <div className="address-content">
                      <strong>{order.billingAddress?.name || "-"}</strong><br />
                      {order.billingAddress?.address1}<br />
                      {order.billingAddress?.zip} {order.billingAddress?.city}
                    </div>
                  </div>
                  <div className="address-box">
                    <div className="section-title">Lieferadresse</div>
                    <div className="address-content">
                      <strong>{order.shippingAddress?.name || "-"}</strong><br />
                      {order.shippingAddress?.address1}<br />
                      {order.shippingAddress?.zip} {order.shippingAddress?.city}
                    </div>
                  </div>
                </div>

                <table className="order-table">
                  <thead>
                    <tr>
                      <th className="order-th-image">Bild</th>
                      <th>Produkt</th>
                      <th className="order-th-qty">Menge</th>
                      <th className="order-th-location">Lagerplatz</th>
                      <th className="order-th-barcode">Barcode</th>
                      <th className="order-th-check">✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => {
                      const isOriginalMultiQty = item.quantity > 1;
                      return (
                        <tr key={item.id}>
                          <td>
                            {item.imageUrl ? (
                              <img className="product-image" src={item.imageUrl} alt="" />
                            ) : (
                              <div className="product-image-placeholder" />
                            )}
                          </td>
                          <td>
                            <div className="product-title">{item.title}</div>
                            {item.germanTranslation && (
                              <div className="german-title">{item.germanTranslation}</div>
                            )}
                            {item.sku && <div className="sku">SKU: {item.sku}</div>}
                            {item.expiryDate && <div className="sku">MHD: {item.expiryDate}</div>}
                            {item.variantTitle && <div className="variant">{item.variantTitle}</div>}
                          </td>
                          
                          <td className={`qty-cell ${isOriginalMultiQty ? "qty-cell-warning" : ""}`}>
                            × {item.quantity}
                            {isOriginalMultiQty && <span className="qty-warning-lbl">수량주의</span>}
                          </td>

                          <td>
                            {item.position ? (
                              <div className="location-tag">{item.position}</div>
                            ) : (
                              <span className="missing-value">—</span>
                            )}
                          </td>
                          <td className="barcode-cell">
                            {item.barcode ? (
                              <Code128 value={item.barcode} height={36} moduleWidth={1.1} />
                            ) : (
                              <span className="missing-value">—</span>
                            )}
                          </td>
                          <td className="check-cell">□</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {order.note && (
                  <div className="note-box">
                    <div className="note-title">Lieferhinweis</div>
                    <div className="note-content">{order.note}</div>
                  </div>
                )}

                <div className="picker-box">
                  <span>Gepackt von: _____________________</span>
                  <span>Kontrolliert von: _____________________</span>
                </div>

                <div className="footer">
                  <div className="thank-you">Vielen Dank für Ihren Einkauf!</div>
                  <table className="footer-grid">
                    <tbody>
                      <tr>
                        <td><span className="footer-label">Geschäftsführer</span>Soonchan Kwon</td>
                        <td><span className="footer-label">Email</span>service@dawayo.de</td>
                        <td><span className="footer-label">Steuer-ID</span>106 5721 6110</td>
                        <td><span className="footer-label">USt-IdNr.</span>DE320890998</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="shop-name">dawayo.de</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}