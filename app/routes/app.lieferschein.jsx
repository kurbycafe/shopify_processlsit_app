import { useLoaderData } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    // ✅ 수정 1: deprecated 필터 제거 + 최신 API 호환 쿼리
    // financial_status / fulfillment_status → displayFinancialStatus / displayFulfillmentStatus 로 변경
    // ✅ 수정 2: lineItems를 10개로 줄여 쿼리 비용 절감 (필요시 cursor pagination 추가)
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
                    sku
                    grams
                    variant {
                      id
                      title
                      barcode
                      image { url }
                    }
                    product {
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
    `);

    // ✅ 수정 3: response.json() 전에 HTTP 상태 코드 확인
    if (!response.ok) {
      const text = await response.text();
      console.error("GraphQL HTTP error:", response.status, text);
      return json({ orders: [], error: `API 오류 (${response.status}): ${text.slice(0, 200)}` });
    }

    const responseJson = await response.json();

    // ✅ 수정 4: GraphQL errors 배열 체크 (throttled, permission 등)
    if (responseJson?.errors?.length > 0) {
      const errMsg = responseJson.errors.map(e => e.message).join(", ");
      console.error("GraphQL errors:", errMsg);
      return json({ orders: [], error: `GraphQL 오류: ${errMsg}` });
    }

    if (!responseJson?.data?.orders?.edges) {
      return json({ orders: [], error: "데이터 구조가 올바르지 않습니다." });
    }

    const orders = responseJson.data.orders.edges.map(edge => {
      const node = edge.node;

      const rawItems = (node.lineItems?.edges || []).map(itemEdge => {
        const item = itemEdge.node;
        const posRaw = item.product?.position?.value || "";
        const posUpper = posRaw.trim().toUpperCase();

        let sortKey = "500_" + posUpper;
        if (!posUpper) sortKey = "999_ZZZZZ";
        else if (posUpper.includes("!")) sortKey = "000_" + posUpper;
        else if (posUpper.includes("L-A")) sortKey = "100_" + posUpper;
        else if (posUpper.includes("L-B")) sortKey = "200_" + posUpper;
        else if (posUpper.includes("L-C")) sortKey = "300_" + posUpper;
        else if (posUpper.includes("L-D")) sortKey = "400_" + posUpper;

        const titleKey = (item.title || "").replace(/["']/g, "").trim().toUpperCase();

        return {
          id: item.id,
          title: (item.title || "").replace(" - Default Title", ""),
          quantity: item.quantity || 0,
          sku: item.sku || "",
          weightKg: item.grams > 0 ? (item.grams / 1000).toFixed(3) : null,
          gramsTotal: (item.grams || 0) * (item.quantity || 0),
          barcode: item.variant?.barcode || "",
          variantTitle: item.variant?.title === "Default Title" ? "" : (item.variant?.title || ""),
          imageUrl: item.variant?.image?.url || null,
          isIcePackage: item.variant?.id?.includes("54301230268745") || false,
          germanTranslation: item.product?.germanTranslation?.value || "",
          expiryDate: item.product?.expiryDate?.value || "",
          position: posRaw,
          _finalSortString: `${sortKey}___:::___${titleKey}`
        };
      });

      const sortedItems = [...rawItems].sort((a, b) =>
        a._finalSortString.localeCompare(b._finalSortString)
      );
      const totalGrams = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
      const hasIcePackage = sortedItems.some(i => i.isIcePackage);

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
        carrier: null,
        billingAddress: node.billingAddress || null,
        shippingAddress: node.shippingAddress || null,
        hasIcePackage,
        totalWeightKg: (totalGrams / 1000).toFixed(3),
        items: sortedItems,
      };
    });

    // ✅ 수정 5: json() 헬퍼로 감싸서 Remix가 올바르게 직렬화하도록 처리
    return json({ orders, error: null });
  } catch (err) {
    console.error("Loader error:", err);
    return json({ orders: [], error: err.message });
  }
};

export default function AdditionalPage() {
  const { orders, error } = useLoaderData();
  const [selectedOrders, setSelectedOrders] = useState([]);

  // ✅ 수정 6: s-page → Page (Shopify Polaris) 또는 일반 div로 교체
  // s-page, s-paragraph 는 특정 환경에서만 동작하므로 범용 div 사용
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            padding: 20,
            color: "#b91c1c",
            background: "#fef2f2",
            borderRadius: 8,
            border: "1px solid #fecaca",
          }}
        >
          <strong>오류 발생:</strong> {error}
        </div>
      </div>
    );
  }

  const handleSelectAll = (e) => {
    setSelectedOrders(
      e.target.checked ? orders.map((o) => o.id) : []
    );
  };

  const handleSelectOrder = (id, checked) => {
    setSelectedOrders((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    );
  };

  const handlePrint = () => {
    if (selectedOrders.length === 0) return;
    window.print();
  };

  const activePrintOrders = orders.filter((o) => selectedOrders.includes(o.id));

  return (
    <div>
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;700;800&display=swap");
        .admin-panel { padding: 20px; background: #fff; border-radius: 8px; margin-bottom: 24px; border: 1px solid #e1e3e5; }
        .list-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .list-table th, .list-table td { padding: 12px 10px; border-bottom: 1px solid #e1e3e5; text-align: left; }
        .print-btn { padding: 10px 20px; background-color: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
        .print-btn:disabled { background-color: #e3e3e3; cursor: not-allowed; color: #999; }
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
        .barcode-wrapper { text-align: center; margin-top: 6px; margin-bottom: 10px; }
        .barcode-title { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
        .barcode-number { margin-top: 3px; font-size: 11px; font-weight: 700; color: #111; letter-spacing: 0.5px; }
        .address-row { width: 100%; margin-top: 22px; display: table; table-layout: fixed; }
        .address-box { display: table-cell; width: 48%; vertical-align: top; }
        .address-box + .address-box { padding-left: 4%; }
        .section-title { font-size: 10px; font-weight: 800; color: #111; border-bottom: 2px solid #111; padding-bottom: 5px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1.5px; }
        .address-content { font-size: 12.5px; line-height: 20px; color: #333; }
        .order-table { width: 100%; margin-top: 26px; border-collapse: collapse; }
        .order-table thead th { border-top: 2px solid #111; border-bottom: 2px solid #111; padding: 9px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: left; text-transform: uppercase; letter-spacing: 1px; }
        .order-table tbody td { border-bottom: 1px solid #e8e8e8; padding: 11px 8px; vertical-align: top; }
        .order-table tbody tr:last-child td { border-bottom: 2px solid #111; }
        .order-table tbody tr:nth-child(even) td { background: #fafafa; }
        .product-image { width: 56px; height: 56px; border-radius: 6px; border: 1px solid #ddd; object-fit: cover; display: block; }
        .product-title { font-size: 13px; font-weight: 700; color: #111; line-height: 17px; }
        .german-title { margin-top: 3px; font-size: 11px; color: #888; font-style: italic; line-height: 15px; }
        .sku { margin-top: 5px; font-size: 10.5px; color: #666; font-family: monospace; }
        .variant { display: inline-block; margin-top: 5px; border: 1px solid #ccc; border-radius: 30px; padding: 2px 8px; font-size: 10px; color: #555; }
        .location-tag { display: inline-block; background: #f0f0f0; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 700; color: #111; margin-top: 2px; }
        .qty-cell { text-align: center; font-size: 26px; font-weight: 800; color: #111; vertical-align: middle; }
        .barcode-cell { text-align: center; vertical-align: middle; }
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
        .mock-barcode { font-family: monospace; font-size: 15px; letter-spacing: -1px; font-weight: bold; transform: scaleY(2); display: inline-block; margin: 2px 0; }
        .page-header { padding: 16px 20px; font-size: 20px; font-weight: 700; border-bottom: 1px solid #e1e3e5; margin-bottom: 20px; }

        @media print {
          .admin-panel, button, .page-header { display: none !important; }
          body, html { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .paper-viewport { background: transparent !important; padding: 0 !important; gap: 0 !important; display: block !important; }
          .packing-slip { width: 100% !important; max-width: 100% !important; min-height: auto !important; box-shadow: none !important; padding: 0mm !important; page-break-after: always; }
        }
      `}</style>

      <div className="page-header">DAWAYO 패킹 시스템</div>

      <div className="admin-panel">
        <p style={{ marginBottom: 12, color: "#555" }}>
          출력할 주문을 선택한 뒤 버튼을 클릭하면 인쇄 팝업이 활성화됩니다.
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
                  checked={
                    selectedOrders.length === orders.length && orders.length > 0
                  }
                />
              </th>
              <th>주문 번호</th>
              <th>날짜</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center", color: "#888" }}>
                  인쇄 가능한 미처리 주문이 없습니다.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      onChange={(e) =>
                        handleSelectOrder(order.id, e.target.checked)
                      }
                    />
                  </td>
                  <td style={{ fontWeight: "bold" }}>{order.name}</td>
                  <td>{order.createdAt}</td>
                  <td style={{ color: "#008060", fontWeight: "bold" }}>
                    Paid / Unfulfilled
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
                      <tr>
                        <td className="info-label">Bestellnummer</td>
                        <td className="info-value">{order.name}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Bestelldatum</td>
                        <td className="info-value">{order.createdAt}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Bestellzeit</td>
                        <td className="info-value">{order.createdTime} Uhr</td>
                      </tr>
                      <tr>
                        <td className="info-label">Versandart</td>
                        <td className="info-value">{order.shippingMethod}</td>
                      </tr>
                      <tr>
                        <td className="info-label">E-Mail</td>
                        <td className="info-value">{order.email}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Gesamtgewicht</td>
                        <td className="info-value">{order.totalWeightKg} kg</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="badges-row">
                    {order.shippingAddress?.company && (
                      <div className="badge">B2B</div>
                    )}
                    {order.hasIcePackage && (
                      <div className="badge badge-ice">❄ Kühlversand</div>
                    )}
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
                    <div className="mock-barcode">||||||| | |||| || ||| | ||</div>
                    <div className="barcode-number">{order.name}</div>
                  </div>
                </div>
              </div>

              <div className="address-row">
                <div className="address-box">
                  <div className="section-title">Rechnungsadresse</div>
                  <div className="address-content">
                    <strong>{order.billingAddress?.name || "-"}</strong>
                    <br />
                    {order.billingAddress?.address1}
                    <br />
                    {order.billingAddress?.zip} {order.billingAddress?.city}
                  </div>
                </div>
                <div className="address-box">
                  <div className="section-title">Lieferadresse</div>
                  <div className="address-content">
                    <strong>{order.shippingAddress?.name || "-"}</strong>
                    <br />
                    {order.shippingAddress?.address1}
                    <br />
                    {order.shippingAddress?.zip} {order.shippingAddress?.city}
                  </div>
                </div>
              </div>

              <table className="order-table">
                <thead>
                  <tr>
                    <th style={{ width: "68px" }}>Bild</th>
                    <th>Produkt</th>
                    <th style={{ width: "80px", textAlign: "center" }}>
                      Menge
                    </th>
                    <th style={{ width: "110px" }}>Lagerplatz</th>
                    <th style={{ width: "130px", textAlign: "center" }}>
                      Barcode
                    </th>
                    <th style={{ width: "46px", textAlign: "center" }}>✓</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.imageUrl && (
                          <img
                            className="product-image"
                            src={item.imageUrl}
                            alt=""
                          />
                        )}
                      </td>
                      <td>
                        <div className="product-title">{item.title}</div>
                        {item.germanTranslation && (
                          <div className="german-title">
                            {item.germanTranslation}
                          </div>
                        )}
                        {item.sku && (
                          <div className="sku">SKU: {item.sku}</div>
                        )}
                        {item.expiryDate && (
                          <div className="sku">MHD: {item.expiryDate}</div>
                        )}
                        {item.variantTitle && (
                          <div className="variant">{item.variantTitle}</div>
                        )}
                      </td>
                      <td className="qty-cell">× {item.quantity}</td>
                      <td>
                        {item.position && (
                          <div className="location-tag">{item.position}</div>
                        )}
                      </td>
                      <td className="barcode-cell">
                        {item.barcode && (
                          <>
                            <div
                              className="mock-barcode"
                              style={{ fontSize: "12px" }}
                            >
                              |||| ||| || |||
                            </div>
                            <div className="barcode-number">{item.barcode}</div>
                          </>
                        )}
                      </td>
                      <td className="check-cell">□</td>
                    </tr>
                  ))}
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
                      <td>
                        <span className="footer-label">Geschäftsführer</span>
                        Soonchan Kwon
                      </td>
                      <td>
                        <span className="footer-label">Email</span>
                        service@dawayo.de
                      </td>
                      <td>
                        <span className="footer-label">Steuer-ID</span>
                        106 5721 6110
                      </td>
                      <td>
                        <span className="footer-label">USt-IdNr.</span>
                        DE320890998
                      </td>
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