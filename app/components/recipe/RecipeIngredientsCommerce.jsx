import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  TextField,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { getConfidenceBadgeTone } from "../../utils/recipeMatchingEngine";

export default function RecipeIngredientsCommerce({
  ingredients = [],
  onChangeIngredients,
  selectedProducts = [],
  onChangeProducts,
  onSearchShopifyProducts,
  searchResults = [],
  searchLoading = false,
}) {
  const [productQuery, setProductQuery] = useState("");

  const handleAddIngredient = () => {
    const newId = `ing_${Date.now()}`;
    onChangeIngredients([
      ...ingredients,
      {
        id: newId,
        nameKo: "",
        nameDe: "",
        nameEn: "",
        amount: 1,
        unit: "g",
        type: "REQUIRED",
        searchKeywords: [],
        suggestedPackageQty: 1,
      },
    ]);
  };

  const handleRemoveIngredient = (id) => {
    onChangeIngredients(ingredients.filter((i) => i.id !== id));
  };

  const handleUpdateIngredient = (id, field, value) => {
    onChangeIngredients(
      ingredients.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  };

  const handleSearch = () => {
    if (!productQuery.trim()) return;
    onSearchShopifyProducts(productQuery);
  };

  const handleAddProductVariant = (product, variant, ingredientId = null) => {
    const exists = selectedProducts.find((p) => p.variantId === variant.id);
    if (exists) return;

    const matchedIngredient = ingredients.find((i) => i.id === ingredientId);

    const newProd = {
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantTitle: variant.title !== "Default Title" ? variant.title : "",
      price: variant.price || "0.00",
      imageUrl: variant.image?.url || product.featuredImage?.url || "",
      ingredientName: matchedIngredient ? matchedIngredient.nameKo || matchedIngredient.nameDe : "",
      matchTier: matchedIngredient?.type === "REQUIRED" ? "PRIMARY" : "ALTERNATIVE",
      confidenceScore: 0.95,
      isApproved: true,
      requiredQuantity: matchedIngredient?.suggestedPackageQty || 1,
      unit: "pack",
      isAvailable: variant.availableForSale !== false,
    };

    onChangeProducts([...selectedProducts, newProd]);
  };

  const handleRemoveProduct = (variantId) => {
    onChangeProducts(selectedProducts.filter((p) => p.variantId !== variantId));
  };

  const handleToggleTier = (variantId) => {
    onChangeProducts(
      selectedProducts.map((p) => {
        if (p.variantId === variantId) {
          const nextTier = p.matchTier === "PRIMARY" ? "ALTERNATIVE" : "PRIMARY";
          return { ...p, matchTier: nextTier };
        }
        return p;
      })
    );
  };

  const handleChangeQty = (variantId, qty) => {
    const num = Math.max(1, Math.min(99, parseInt(qty) || 1));
    onChangeProducts(
      selectedProducts.map((p) => (p.variantId === variantId ? { ...p, requiredQuantity: num } : p))
    );
  };

  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <div>
            <Text as="h2" variant="headingMd">식재료 & Shopify 상품 커머스 매칭</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              레시피 요리 재료(Recipe Requirement)와 상점 판매 단위(Commerce Package)를 연결합니다.
            </Text>
          </div>
          <Button onClick={handleAddIngredient} size="slim">
            + 식재료 항목 추가
          </Button>
        </InlineStack>

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" fontWeight="bold">1. 레시피 조리 재료 목록 (필요량)</Text>
          
          {ingredients.length === 0 ? (
            <Box padding="300" background="bg-surface-secondary" borderRadius="200" textAlign="center">
              <Text as="p" tone="subdued">등록된 조리 재료가 없습니다. 프리셋을 적용하거나 항목을 추가하세요.</Text>
            </Box>
          ) : (
            <div style={{ maxHeight: "260px", overflowY: "auto" }}>
              <BlockStack gap="200">
                {ingredients.map((ing, idx) => (
                  <Box key={ing.id || idx} padding="200" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ flex: 2 }}>
                        <TextField
                          label="한국어 재료명"
                          labelHidden
                          value={ing.nameKo || ""}
                          onChange={(val) => handleUpdateIngredient(ing.id, "nameKo", val)}
                          placeholder="한국어 (예: 떡볶이 떡)"
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 2 }}>
                        <TextField
                          label="독일어 재료명"
                          labelHidden
                          value={ing.nameDe || ""}
                          onChange={(val) => handleUpdateIngredient(ing.id, "nameDe", val)}
                          placeholder="독일어 (예: Reiskuchen)"
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ width: "70px" }}>
                        <TextField
                          label="필요량"
                          labelHidden
                          type="number"
                          value={String(ing.amount || 1)}
                          onChange={(val) => handleUpdateIngredient(ing.id, "amount", parseFloat(val) || 1)}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ width: "70px" }}>
                        <TextField
                          label="단위"
                          labelHidden
                          value={ing.unit || "g"}
                          onChange={(val) => handleUpdateIngredient(ing.id, "unit", val)}
                          placeholder="g/큰술"
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ width: "90px" }}>
                        <select
                          value={ing.type || "REQUIRED"}
                          onChange={(e) => handleUpdateIngredient(ing.id, "type", e.target.value)}
                          style={{
                            height: "32px",
                            borderRadius: "6px",
                            border: "1px solid #c9cccf",
                            padding: "0 4px",
                            fontSize: "12px",
                            background: "#ffffff"
                          }}
                        >
                          <option value="REQUIRED">필수</option>
                          <option value="OPTIONAL">선택</option>
                        </select>
                      </div>
                      <Button
                        size="micro"
                        tone="critical"
                        onClick={() => handleRemoveIngredient(ing.id)}
                      >
                        삭제
                      </Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </div>
          )}
        </BlockStack>

        <Divider />

        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm" fontWeight="bold">
              2. 연결된 Shopify 상점 상품 (총 {selectedProducts.length}개)
            </Text>
            <Badge tone="success">위젯에 자동 번들링</Badge>
          </InlineStack>

          {selectedProducts.length === 0 ? (
            <Banner tone="warning">
              연결된 상점 상품이 없습니다. 아래 검색창을 통해 판매 중인 제품을 매칭해 주세요.
            </Banner>
          ) : (
            <BlockStack gap="200">
              {selectedProducts.map((p) => {
                const conf = getConfidenceBadgeTone(p.confidenceScore || 1.0);
                return (
                  <Box key={p.variantId} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" gap="300">
                      <InlineStack gap="300" blockAlign="center" style={{ flex: 1 }}>
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.title}
                            style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e1e3e5" }}
                          />
                        ) : (
                          <Box width="48px" height="48px" background="bg-surface-secondary-active" borderRadius="200" />
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text as="p" variant="bodyMd" fontWeight="bold">
                            {p.title}
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            {p.variantTitle && (
                              <Text as="span" variant="bodyXs" tone="subdued">
                                옵션: {p.variantTitle}
                              </Text>
                            )}
                            <Text as="span" variant="bodySm" tone="critical" fontWeight="bold">
                              €{parseFloat(p.price || 0).toFixed(2)}
                            </Text>
                            <Badge tone={conf.tone}>{conf.label}</Badge>
                            {p.isAvailable === false && <Badge tone="critical">품절</Badge>}
                          </InlineStack>
                        </div>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <Text as="span" variant="bodyXs" tone="subdued">구매수량:</Text>
                          <input
                            type="number"
                            min="1"
                            max="99"
                            value={p.requiredQuantity || 1}
                            onChange={(e) => handleChangeQty(p.variantId, e.target.value)}
                            style={{ width: "40px", height: "28px", textAlign: "center", borderRadius: "4px", border: "1px solid #cbd5e0" }}
                          />
                        </div>

                        <Button
                          size="slim"
                          variant={p.matchTier === "PRIMARY" ? "primary" : "secondary"}
                          onClick={() => handleToggleTier(p.variantId)}
                        >
                          {p.matchTier === "PRIMARY" ? "Essential (필수)" : "Complete (옵션)"}
                        </Button>

                        <Button size="slim" tone="critical" onClick={() => handleRemoveProduct(p.variantId)}>
                          제거
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          )}
        </BlockStack>

        <Divider />

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" fontWeight="bold">3. 상점 인벤토리 검색 및 수동 매칭</Text>
          <InlineStack gap="200">
            <div style={{ flexGrow: 1 }}>
              <TextField
                value={productQuery}
                onChange={setProductQuery}
                placeholder="상품명 또는 키워드 입력 (예: 고추장, 떡, 김치, 간장...)"
                autoComplete="off"
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
            </div>
            <Button onClick={handleSearch} loading={searchLoading}>
              상품 검색
            </Button>
          </InlineStack>

          {searchResults.length > 0 && (
            <Box padding="200" background="bg-surface" borderRadius="200" style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid #e1e3e5" }}>
              <BlockStack gap="200">
                {searchResults.map((product) => (
                  <Box key={product.id} padding="200" style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="bold">{product.title}</Text>
                      <BlockStack gap="100">
                        {product.variants.nodes.map((v) => {
                          const isAdded = selectedProducts.some((sp) => sp.variantId === v.id);
                          return (
                            <InlineStack key={v.id} align="space-between" blockAlign="center">
                              <Text as="span" variant="bodyXs" tone="subdued">
                                - {v.title !== "Default Title" ? v.title : "기본 옵션"} (€{parseFloat(v.price).toFixed(2)})
                              </Text>
                              <Button
                                size="micro"
                                onClick={() => handleAddProductVariant(product, v)}
                                disabled={isAdded}
                              >
                                {isAdded ? "추가됨" : "+ 레시피에 추가"}
                              </Button>
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </Box>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
