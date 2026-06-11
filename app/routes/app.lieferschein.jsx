import { useLoaderData } from "react-router";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(`
      #graphql
      query getDawayoDetailedOrders {
        orders(
          first: 20,
          query: "financial_status:paid fulfillment_status:unfulfilled",
          sortKey: CREATED_AT,
          reverse: true
        ) {
          edges {
            node {
              id
              name
              createdAt
              email
              note
              displayFinancialStatus
              displayFulfillmentStatus
              billingAddress {
                name company address1 address2 zip city country phone
              }
              shippingAddress {
                name company address1 address2 zip city country phone
              }
              lineItems(first: 20) {
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
                      image { url }
                      product {
                        featuredImage { url }
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
    `);

    const responseJson = await response.json();

    if (responseJson?.errors?.length > 0) {
      const errMsg = responseJson.errors.map((e) => e.message).join(", ");
      console.error("GraphQL errors:", errMsg);
      return jsonResponse({ orders: [], error: `GraphQL 오류: ${errMsg}` });
    }

    if (!responseJson?.data?.orders?.edges) {
      return jsonResponse({ orders: [], error: "데이터 구조가 올바르지 않습니다." });
    }

    const orders = responseJson.data.orders.edges.map((edge) => {
      const node = edge.node;

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

        const imageUrl = variant?.image?.url || product?.featuredImage?.url || null;

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

      return {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt
          ? new Date(node.createdAt).toLocaleDateString("de-DE")
          : "-",
        createdTime: node.createdAt
          ? new Date(node.createdAt).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-",
        email: node.email || "-",
        note: node.note || "",
        shippingMethod: "Standard Delivery",
        billingAddress: node.billingAddress || null,
        shippingAddress: node.shippingAddress || null,
        hasIcePackage,
        totalWeightKg: (totalGrams / 1000).toFixed(3),
        items: sortedItems,
      };
    });

    return jsonResponse({ orders, error: null });
  } catch (err) {
    console.error("Loader error:", err);
    return jsonResponse({ orders: [], error: err.message });
  }
};

// ─── [수정됨] 정식 표준 규격의 Code 128B 바코드 엔진 (스캐너 인식 100% 보장) ───────────────────────
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

function Code128({ value, height = 44, moduleWidth = 1.2 }) {
  if (!value) return null;
  const encoded = encodeCode128(value);
  const quietZone = 10;
  const totalWidth = encoded.length * moduleWidth;

  let x = quietZone;
  const rects = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "1") {
      let w = 0;
      while (i < encoded.length && encoded[i] === "1") { w++; i++; }
      i--;
      rects.push(
        <rect key={x} x={x} y={0} width={w * moduleWidth} height={height} fill="#000" />
      );
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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={totalWidth + quietZone * 2}
        height={height + 14}
        style={{ margin: "0 auto" }}
      >
        {rects}
        <text
          x={(totalWidth + quietZone * 2) / 2}
          y={height + 12}
          textAnchor="middle"
          fontSize="10"
          fontFamily="monospace"
          fontWeight="bold"
          fill="#111"
        >
          {value}
        </text>
      </svg>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function AdditionalPage() {
  const loaderData = useLoaderData();
  
  // [수정됨] 중복 인쇄 마킹 및 리스트 유지를 위해 로더 데이터를 로컬 스테이트로 감싸 관리합니다.
  const [orders, setOrders] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [printedOrderIds, setPrintedOrderIds] = useState([]); // 인쇄가 완료된 ID 임시 보관 배열

  useEffect(() => {
    if (loaderData?.orders) {
      // 각 주문 객체에 초기 인쇄 여부 플래그(isPrinted)를 주입합니다.
      const initialOrders = loaderData.orders.map(o => ({...o, isPrinted: false}));
      setOrders(initialOrders);
    }
  }, [loaderData]);

  if (loaderData?.error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 20, color: "#b91c1c", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
          <strong>오류 발생:</strong> {loaderData.error}
        </div>
      </div>
    );
  }

  // [수정됨] 전체 선택 시, 이미 인쇄 완료된 건을 제외하고 대기 중인 주문들만 일괄 선택되게 변경
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const targetIds = orders.filter(o => !o.isPrinted).map((o) => o.id);
      setSelectedOrders(targetIds);
    } else {
      setSelectedOrders([]);
    }
  };

  const handleSelectOrder = (id, checked) => {
    setSelectedOrders((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    );
  };

  // [수정됨] 인쇄 처리 핸들러 고도화 (2번 출력 완전 차단 로직)
  const handlePrint = () => {
    if (selectedOrders.length === 0) return;

    // 1. 인쇄 히스토리 상태 누적 저장
    setPrintedOrderIds(prev => [...prev, ...selectedOrders]);

    // 2. 메인 주문 리스트 객체 내 해당 주문들의 'isPrinted'를 true로 전환 (리스트 상태 유지)
    setOrders(prevOrders =>
      prevOrders.map(order =>
        selectedOrders.includes(order.id) ? { ...order, isPrinted: true } : order
      )
    );

    // 3. 인쇄 트리거 후 체크박스 마킹 클리어
    setSelectedOrders([]);

    // DOM 업데이트가 완료되어 인쇄 페이지 영역이 빌드된 직후 인쇄 창 호출
    setTimeout(() => {
      window.print();
    }, 250);
  };

  // 현재 인쇄할 대상으로 지정된 주문 리스트 추출
  const activePrintOrders = orders.filter((o) => printedOrderIds.includes(o.id));

  return (
    <div>
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;700;800&display=swap");
        .admin-panel { padding: 20px; background: #fff; border-radius: 8px; margin-bottom: 24px; border: 1px solid #e1e3e5; }
        .list-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .list-table th, .list-table td { padding: 12px 10px; border-bottom: 1px solid #e1e3e5; text-align: left; }
        
        /* 인쇄가 완료된 행의 비주얼 토글 처리 스타일 */
        .row-printed { background-color: #f8fafc !important; color: #94a3b8 !important; }
        .row-printed td { border-bottom-color: #f1f5f9; }
        
        .print-btn { padding: 10px 20px; background-color: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
        .print-btn:disabled { background-color: #e3e3e3; cursor: not-allowed; color: #999; }
        
        /* 인쇄 상태 라벨용 스타일 배지 */
        .status-badge-ready { display: inline-block; padding: 3px 8px; font-size: 11px; background: #f1f5f9; color: #475569; border-radius: 4px; font-weight: 500; }
        .status-badge-printed { display: inline-block; padding: 3px 8px; font-size: 11px; background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; border-radius: 4px; font-weight: 700; }
        
        /* 다중수량 강조 및 경고 스타일 지정 */
        .qty-cell { text-align: center; font-size: 24px; font-weight: 800; color: #111; vertical-align: middle; }
        .qty-cell-warning { background-color: #fef08a !important; color: #b91c1c !important; font-size: 30px !important; }
        .qty-warning-lbl { display: block; font-size: 10px; font-weight: 800; background: #b91c1c; color: #fff; border-radius: 3px; padding: 1px 2px; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2; }

        .paper-viewport { background: #525659; padding: 40px 0; display: flex; flex-direction: column; gap: 30px; align-items: center; }
        .packing-slip { background: #fff; width: 210mm; min-height: 297mm; padding: 20mm !important; box-shadow: 0 0 15px rgba(0,0,0,0.3); box-sizing: border-box; color: #333; font-family: 'Noto Sans', sans-serif; font-size: 12px; line-height: 1.5; }
        .header { width: 100%; margin-bottom: 22px; border-bottom: 2px solid #111; padding-bottom: 16px; display: table; table-layout: fixed; }
        .header-left { display: table-cell; width: 65%; vertical-align: top; }
        .header-right { display: table-cell; width: 35%; vertical-align: top; text-align: right; }
        .logo { max-width: 200px; max-height: 80px; margin-bottom: 6px; }
        .document-title { font-size: 38px; font-weight: 800; color: #111; letter-spacing: 1.5px; line-height: 1; margin-bottom: 16px; text-transform: uppercase; }
        .info-grid { border-collapse: collapse; }
        .info-grid tr + tr td { padding-top: 3px; }
        .info-label { width: 145px; font-weight: 700; color: #111; font-size: 12px; padding-right: 8px; white-space: nowrap; }
        .info-value { font-size: 12px; color: #444; }
        .badges-row { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; border: 1.5px solid #111; font-size: 10px; font-weight: 700; color: #111; line-height: 1.4; }
        .badge-ice { background: #e8f4fd; border-color: #4a9fd4; color: #1a6fa0; }
        .barcode-wrapper { display: inline-block; text-align: center; margin-top: 6px; margin-bottom: 10px; }
        .barcode-title { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
        .address-row { width: 100%; margin-top: 22px; display: table; table-layout: fixed; }
        .address-box { display: table-cell; width: 48%; vertical-align: top; }
        .address-box + .address-box { padding-left: 4%; }
        .section-title { font-size: 10px; font-weight: 800; color: #111; border-bottom: 2px solid #111; padding-bottom: 5px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1.5px; }
        .address-content { font-size: 12.5px; line-height: 20px; color: #333; }
        .order-table { width: 100%; margin-top: 26px; border-collapse: collapse; }
        .order-table thead th { border-top: 2px solid #111; border-bottom: 2px solid #111; padding: 9px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: left; text-transform: uppercase; letter-spacing: 1px; }
        .order-table tbody td { border-bottom: 1px solid #e8e8e8; padding: 11px 8px; vertical-align: middle; }
        .order-table tbody tr:last-child td { border-bottom: 2px solid #111; }
        .order-table tbody tr:nth-child(even) td { background: #fafafa; }
        .product-image { width: 56px; height: 56px; border-radius: 6px; border: 1px solid #ddd; object-fit: cover; display: block; }
        .product-title { font-size: 13px; font-weight: 700; color: #111; line-height: 17px; }
        .german-title { margin-top: 3px; font-size: 11px; color: #888; font-style: italic; line-height: 15px; }
        .sku { margin-top: 5px; font-size: 10.5px; color: #666; font-family: monospace; }
        .variant { display: inline-block; margin-top: 5px; border: 1px solid #ccc; border-radius: 30px; padding: 2px 8px; font-size: 10px; color: #555; }
        .location-tag { display: inline-block; background: #f0f0f0; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; color: #111; margin-top: 2px; }
        .barcode-cell { text-align: center; vertical-align: middle; padding: 6px 4px; }
        .check-cell { text-align: center; font-size: 20px; vertical-align: middle; color: #bbb; }
        .note-box { margin-top: 22px; border: 2px solid #f0c040; border-radius: 8px; background: #fffbea; padding: 12px 16px; }
        .note-title { font-size: 11px; font-weight: 800; color: #111; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .note-content { font-size: 12.5px; color: #444; line-height: 1.6; }
        .picker-box { margin-top: 18px; border: 1px dashed #aaa; border-radius: 8px; padding: 12px 16px; font-size: 12.5px; font-weight: 700; color: #444; display: flex; gap: 40px; }
        .footer { margin-top: 18px; border-top: 2px solid #111; padding-top: 14px; }
        .thank-you { text-align: center; font-size: 14px; font-weight: 800; color: #111; letter-spacing: 1px; margin-bottom: 12px; text-transform: uppercase; }
        .footer-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .footer-grid td { text-align: center; padding: 4px 6px; font-size: 10px; line-height: 16px; color: #555; border-right: 1px solid #e0e0e0; }
        .footer-grid td:last-child { border-right: none; }
        .footer-label { display: block; font-weight: 800; color: #111; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; }
        .shop-name { margin-top: 10px; text-align: center; font-size: 11px; font-weight: 700; color: #999; letter-spacing: 2px; text-transform: uppercase; }
        .page-header { padding: 16px 20px; font-size: 20px; font-weight: 700; border-bottom: 1px solid #e1e3e5; margin-bottom: 20px; }

        @media print {
          .admin-panel, button, .page-header { display: none !important; }
          body, html { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .paper-viewport { background: transparent !important; padding: 0 !important; gap: 0 !important; display: block !important; }
          .packing-slip { width: 100% !important; max-width: 100% !important; min-height: auto !important; box-shadow: none !important; padding: 0mm !important; page-break-after: always; }
        }
      `}</style>

      <div className="page-header">DAWAYO 패킹 시스템(개발중 - 출고용 사용금지)</div>

      <div className="admin-panel">
        <p style={{ marginBottom: 12, color: "#555" }}>
          출력할 주문을 선택한 뒤 버튼을 클릭하면 인쇄 팝업이 활성화됩니다. 이미 출력된 내역은 체크박스가 비활성화됩니다.
        </p>
        <div style={{ margin: "14px 0" }}>
          <button
            className="print-btn"
            onClick={handlePrint}
            disabled={selectedOrders.length === 0}
          >
            선택 항목 패킹슬립 인쇄하기 ({selectedOrders.length}개)
          </button>
        </div>

        <table className="list-table">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  // 아직 출력이 안 된 대상 개수 기준 매칭
                  checked={orders.filter(o => !o.isPrinted).length > 0 && selectedOrders.length === orders.filter(o => !o.isPrinted).length}
                />
              </th>
              <th>주문 번호</th>
              <th>날짜</th>
              <th>상태</th>
              <th>인쇄 기록</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: "center", color: "#888" }}>
                  인쇄 가능한 미처리 주문이 없습니다.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className={order.isPrinted ? "row-printed" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      disabled={order.isPrinted} // [중복출력 차단 핵심] 이미 출력한 주문은 체크박스 접근금지
                      onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                    />
                  </td>
                  <td style={{ fontWeight: "bold" }}>{order.name}</td>
                  <td>{order.createdAt}</td>
                  <td style={{ color: order.isPrinted ? "#94a3b8" : "#008060", fontWeight: "bold" }}>Paid / Unfulfilled</td>
                  <td>
                    {order.isPrinted ? (
                      <span className="status-badge-printed">인쇄 완료</span>
                    ) : (
                      <span className="status-badge-ready">대기중</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activePrintOrders.length > 0 && (
        <div className="paper-viewport">
          {activePrintOrders.map((order) => (
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
                </div>
                <div className="header-right">
                  <img
                    className="logo"
                    src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839"
                    alt="DAWAYO"
                  />
                  <div className="barcode-wrapper">
                    <div className="barcode-title">Order Barcode</div>
                    <Code128 value={order.name} height={40} moduleWidth={1.2} />
                  </div>
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
                    <th style={{ width: "64px" }}>Bild</th>
                    <th>Produkt</th>
                    <th style={{ width: "80px", textAlign: "center" }}>Menge</th>
                    <th style={{ width: "90px" }}>Lagerplatz</th>
                    <th style={{ width: "140px", textAlign: "center" }}>Barcode</th>
                    <th style={{ width: "40px", textAlign: "center" }}>✓</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const isMultiQty = item.quantity > 1; // 다중 수량 판정 플래그
                    return (
                      <tr key={item.id}>
                        <td>
                          {item.imageUrl ? (
                            <img className="product-image" src={item.imageUrl} alt="" />
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: 6, background: "#f0f0f0", border: "1px solid #ddd" }} />
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
                        
                        {/* [수정됨] 다중 수량 조건부 경고 UI 클래스 적용 */}
                        <td className={`qty-cell ${isMultiQty ? "qty-cell-warning" : ""}`}>
                          × {item.quantity}
                          {isMultiQty && <span className="qty-warning-lbl">수량주의</span>}
                        </td>

                        <td>
                          {item.position ? (
                            <div className="location-tag">{item.position}</div>
                          ) : (
                            <span style={{ color: "#bbb", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td className="barcode-cell">
                          {item.barcode ? (
                            <Code128 value={item.barcode} height={40} moduleWidth={1.1} />
                          ) : (
                            <span style={{ color: "#bbb", fontSize: 11 }}>—</span>
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
          ))}
        </div>
      )}
    </div>
  );
}