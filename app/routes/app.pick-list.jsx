import React, { useState, useEffect } from "react";
import { Page, Card, DataTable, Spinner, BlockStack, Box } from "@shopify/polaris";

export default function PickList() {
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 백엔드의 픽리스트 API 호출
    // App Bridge를 사용 중이라면 일반 fetch 대신 'useAuthenticatedFetch'를 사용하는 것이 좋습니다.
    fetch("/api/orders/picklist")
      .then((res) => res.json())
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("데이터 로드 실패:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Page title="Pick List">
        <Card>
          <Box padding="500">
            <BlockStack inlineAlign="center">
              <Spinner accessibilityLabel="로딩 중" size="large" />
            </BlockStack>
          </Box>
        </Card>
      </Page>
    );
  }

  // 객체 형태의 데이터를 Polaris DataTable 포맷([ [sku, title, qty], ... ])으로 변환
  const rows = Object.entries(items).map(([sku, item]) => [
    sku,
    item.title,
    item.qty,
  ]);

  return (
    <Page title="Pick List">
      <Card>
        <DataTable
          columnContentTypes={["text", "text", "numeric"]}
          headings={["SKU", "Product", "Qty"]}
          rows={rows}
        />
      </Card>
    </Page>
  );
}