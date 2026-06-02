import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

const UNFULFILLED_ORDERS_QUERY = `#graphql
  query UnfulfilledOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "fulfillment_status:unfulfilled") {
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

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
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
  };
};

export default function PickListPage() {
  const { items, totalUnfulfilledProducts } = useLoaderData();

  return (
    <s-page heading="처리중 리스트 (주문 미처리)">
      <s-section heading={`총 ${totalUnfulfilledProducts}개 상품`}>
        {items.length === 0 ? (
          <s-paragraph>현재 주문 미처리 상태의 주문이 없습니다.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "left" }}>
                    상품명
                  </th>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "left" }}>
                    SKU
                  </th>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "left" }}>
                    Barcode
                  </th>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "right" }}>
                    주문 수량
                  </th>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "right" }}>
                    현재 재고
                  </th>
                  <th style={{ borderBottom: "1px solid #dfe3e8", padding: "8px", textAlign: "left" }}>
                    주문번호 목록
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.productName}-${item.sku}-${item.barcode}`}>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px" }}>
                      {item.productName}
                    </td>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px" }}>{item.sku}</td>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px" }}>{item.barcode}</td>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px", textAlign: "right" }}>
                      {item.orderedQty}
                    </td>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px", textAlign: "right" }}>
                      {item.inventoryQty === null ? "-" : item.inventoryQty}
                    </td>
                    <td style={{ borderBottom: "1px solid #f1f2f3", padding: "8px" }}>
                      {item.orderNumbers.join(", ")}
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