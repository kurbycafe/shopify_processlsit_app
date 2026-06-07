import { Form, useLoaderData, useNavigation } from "react-router";
import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";

const UNFULFILLED_ORDERS_QUERY = `#graphql
  query UnfulfilledOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "fulfillment_status:unfulfilled -financial_status:pending") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        lineItems(first: 250) {
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
              }
            }
          }
        }
      }
    }
  }
`;

async function loadPickListData(admin) {
  const itemMap = new Map();
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, {
      variables: {
        first: 50,
        after,
      },
    });

    const payload = await response.json();

    if (payload.errors?.length) {
      throw new Response("Shopify 주문 조회 중 오류가 발생했습니다.", {
        status: 500,
      });
    }

    const ordersConnection = payload?.data?.orders;
    const orders = ordersConnection?.nodes ?? [];

    for (const order of orders) {
      const orderNumber = order.name;
      const lineItems = order?.lineItems?.nodes ?? [];

      for (const lineItem of lineItems) {
        const variant = lineItem.variant;
        const sku = variant?.sku || "-";
        const barcode = variant?.barcode || "-";
        const productName = variant?.product?.title || lineItem.name || "알 수 없는 상품";
        const variantId = variant?.id;
        const key = variantId || `${productName}__${sku}__${barcode}`;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            productName,
            sku,
            barcode,
            orderedQty: 0,
            inventoryQty:
              typeof variant?.inventoryQuantity === "number"
                ? variant.inventoryQuantity
                : null,
            orderNumbers: new Set(),
          });
        }

        const current = itemMap.get(key);
        current.orderedQty += lineItem.quantity || 0;
        current.orderNumbers.add(orderNumber);

        if (
          current.inventoryQty === null &&
          typeof variant?.inventoryQuantity === "number"
        ) {
          current.inventoryQty = variant.inventoryQuantity;
        }
      }
    }

    hasNextPage = Boolean(ordersConnection?.pageInfo?.hasNextPage);
    after = ordersConnection?.pageInfo?.endCursor || null;
  }

  const items = Array.from(itemMap.values())
    .map((item) => ({
      productName: item.productName,
      sku: item.sku,
      barcode: item.barcode,
      orderedQty: item.orderedQty,
      inventoryQty: item.inventoryQty,
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    .sort((a, b) => b.orderedQty - a.orderedQty || a.productName.localeCompare(b.productName));

  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, item) => sum + item.orderedQty, 0),
    scopeError: null,
  };
}

function createExcelBuffer(items) {
  const rows = items.map((item, index) => ({
    No: index + 1,
    "상품명": item.productName,
    SKU: item.sku,
    Barcode: item.barcode,
    "주문 수량": item.orderedQty,
    "현재 재고": item.inventoryQty === null ? "-" : item.inventoryQty,
    "주문번호 목록": item.orderNumbers.join(", "),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "처리중 리스트");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    return await loadPickListData(admin);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Access denied for orders field")) {
      return {
        items: [],
        totalUnfulfilledProducts: 0,
        totalOrderedQty: 0,
        scopeError:
          "orders 권한이 없어 주문을 조회할 수 없습니다. Shopify 앱을 재설치하거나 권한 업데이트를 승인해 주세요.",
      };
    }

    throw error;
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "export-excel") {
    return new Response("Unsupported action", { status: 400 });
  }

  const { admin } = await authenticate.admin(request);
  const data = await loadPickListData(admin);
  const buffer = createExcelBuffer(data.items);
  const fileName = `process-list-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(buffer.length),
    },
  });
};

export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();
  const navigation = useNavigation();
  const isExporting = navigation.state !== "idle" && navigation.formData?.get("intent") === "export-excel";

  const cardStyles = {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  };

  const metricCardStyle = {
    border: "1px solid rgba(223, 227, 232, 1)",
    borderRadius: "16px",
    padding: "16px",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  const toolbarStyle = {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  };

  const tableWrapStyle = {
    overflowX: "auto",
    border: "1px solid rgba(223, 227, 232, 1)",
    borderRadius: "16px",
    background: "#fff",
  };

  const tableStyle = {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: "980px",
  };

  const headerCellStyle = {
    position: "sticky",
    top: 0,
    background: "#0f172a",
    color: "#fff",
    padding: "12px 14px",
    textAlign: "left",
    fontSize: "13px",
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
  };

  const bodyCellStyle = {
    borderTop: "1px solid #eef2f7",
    padding: "12px 14px",
    verticalAlign: "top",
    fontSize: "14px",
  };

  return (
    <s-page heading="처리중 리스트 (주문 미처리)">
      <s-section
        heading="처리중 리스트"
        description="미처리 주문을 상품별로 모아 보고, Excel로 바로 내려받을 수 있습니다."
      >
        <div style={toolbarStyle}>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>총 상품 수</div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: "#0f172a" }}>{totalUnfulfilledProducts}</div>
            </div>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>총 주문 수량</div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: "#0f172a" }}>{totalOrderedQty}</div>
            </div>
          </div>

          <Form method="post">
            <input type="hidden" name="intent" value="export-excel" />
            <s-button type="submit" variant="primary" {...(isExporting ? { loading: true } : {})}>
              Excel 다운로드
            </s-button>
          </Form>
        </div>

        {scopeError ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="critical-subdued">
            <s-paragraph>{scopeError}</s-paragraph>
          </s-box>
        ) : null}

        {items.length === 0 ? (
          <s-box padding="large" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>현재 주문 미처리 상태의 주문이 없습니다.</s-paragraph>
          </s-box>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>
                    상품명
                  </th>
                  <th style={headerCellStyle}>
                    SKU
                  </th>
                  <th style={headerCellStyle}>
                    Barcode
                  </th>
                  <th style={{ ...headerCellStyle, textAlign: "right" }}>
                    주문 수량
                  </th>
                  <th style={{ ...headerCellStyle, textAlign: "right" }}>
                    현재 재고
                  </th>
                  <th style={headerCellStyle}>
                    주문번호 목록
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.productName}-${item.sku}-${item.barcode}`} style={{ background: "#fff" }}>
                    <td style={bodyCellStyle}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{item.productName}</div>
                    </td>
                    <td style={bodyCellStyle}>{item.sku}</td>
                    <td style={bodyCellStyle}>{item.barcode}</td>
                    <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 600 }}>
                      {item.orderedQty}
                    </td>
                    <td style={{ ...bodyCellStyle, textAlign: "right" }}>
                      {item.inventoryQty === null ? "-" : item.inventoryQty}
                    </td>
                    <td style={bodyCellStyle}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {item.orderNumbers.map((orderNumber) => (
                          <span
                            key={orderNumber}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 10px",
                              borderRadius: "999px",
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            {orderNumber}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}