import { Card, BlockStack, InlineStack, Text, Banner } from "@shopify/polaris";

export function InventorySampleCard({ sampleDebug }) {
  if (!sampleDebug) return null;

  return (
    <Card padding="500">
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text variant="headingMd" as="h3">
            Shopify 세율 참고 결과 (확인된 품목 최대 10개)
          </Text>
          <Text variant="bodySm" tone="subdued">
            배송 기준국가: {sampleDebug.addressUsed?.country} ({sampleDebug.addressUsed?.city} {sampleDebug.addressUsed?.zip})
          </Text>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          최근 주문 5건의 상품 일부와 제한된 세금 계산 결과를 참고합니다. 전체 상품의 세율을 검증한 자료가 아니며, 확인하지 못한 세율은 미확인으로 표시합니다.
        </Text>

        {sampleDebug.userErrors?.length > 0 && (
          <Banner tone="critical" title="Shopify 세금 계산 API 오류">
            {sampleDebug.userErrors.map((e, idx) => (
              <p key={idx}>{e.field ? `[${e.field}] ` : ""}{e.message}</p>
            ))}
          </Banner>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ background: "#f6f6f7", borderBottom: "1px solid #dfe3e8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px", width: "40px" }}>No</th>
                <th style={{ padding: "8px 12px" }}>상품명</th>
                <th style={{ padding: "8px 12px" }}>Shopify 계산 세금 항목</th>
                <th style={{ padding: "8px 12px", textAlign: "center", width: "100px" }}>산출 세율</th>
              </tr>
            </thead>
            <tbody>
              {sampleDebug.sampleItems?.length > 0 ? (
                sampleDebug.sampleItems.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ padding: "8px 12px", color: "#6d7175" }}>{idx + 1}</td>
                    <td style={{ padding: "8px 12px", fontWeight: "600" }}>{item.title}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {item.taxLines?.length > 0 ? (
                        item.taxLines.map((tl, tIdx) => (
                          <span key={tIdx} style={{ marginRight: "10px" }}>
                            <strong>{tl.title || "세금"}</strong>: {tl.ratePercentage != null ? `${tl.ratePercentage}%` : `${Math.round((tl.rate || 0) * 100)}%`}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "#8c9196" }}>과세 항목 없음 (0%)</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontWeight: "600",
                          background: item.rate > 0 ? (item.rate === 7 ? "#ebfbee" : "#e7f5ff") : "#f1f3f5",
                          color: item.rate > 0 ? (item.rate === 7 ? "#2b8a3e" : "#1971c2") : "#495057",
                        }}
                      >
                        {item.rate}%
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ padding: "12px", textAlign: "center", color: "#6d7175" }}>
                    과세 대상 샘플 상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </BlockStack>
    </Card>
  );
}
