import { BlockStack, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";

/**
 * Shared Shopify product search card used across app management panels.
 */
export function ShopifyProductSearchPicker({
  title,
  placeholder,
  productSearchQuery,
  setProductSearchQuery,
  searchFetcher,
  selectButtonLabel,
  selectButtonVariant,
  renderSubtitle,
  onSelectProduct,
}) {
  const submitSearch = () => {
    const fd = new FormData();
    fd.append("intent", "search_shopify_products");
    fd.append("query", productSearchQuery);
    searchFetcher.submit(fd, { method: "post" });
  };

  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h2">
          {title}
        </Text>
        <InlineStack gap="200">
          <div style={{ flex: 1 }}>
            <TextField
              label="상품명 또는 SKU 검색"
              labelHidden
              placeholder={placeholder}
              value={productSearchQuery}
              onChange={setProductSearchQuery}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && productSearchQuery.trim()) {
                  e.preventDefault();
                  submitSearch();
                }
              }}
            />
          </div>
          <Button loading={searchFetcher.state !== "idle"} onClick={submitSearch}>
            쇼피파이 상품 검색
          </Button>
        </InlineStack>

        {searchFetcher.data?.searchedProducts && (
          <BlockStack gap="200">
            {searchFetcher.data.searchedProducts.map((sp) => (
              <div
                key={sp.productId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {sp.imageUrl && (
                    <img
                      src={sp.imageUrl}
                      alt={sp.title}
                      style={{
                        width: "36px",
                        height: "36px",
                        objectFit: "contain",
                      }}
                    />
                  )}
                  <div>
                    <Text variant="bodySm" fontWeight="bold" as="p">
                      {sp.title}
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {renderSubtitle(sp)}
                    </Text>
                  </div>
                </div>
                <Button
                  size="slim"
                  variant={selectButtonVariant}
                  onClick={() => onSelectProduct(sp)}
                >
                  {selectButtonLabel}
                </Button>
              </div>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
