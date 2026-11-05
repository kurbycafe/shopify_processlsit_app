import { AdminListRow } from "./shared.jsx";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";

// "hotdeals" tab of the app management screen (moved out of app.app-management.jsx).
export function HotDealsPanel({
  activeTab,
  config,
  liveVariantPrices = {},
  dealForm,
  fetcher,
  handleDealBasePriceChange,
  handleDealDiscountRateChange,
  handleDealSalePriceChange,
  handleEditDeal,
  handleSelectDealProduct,
  isSubmitting,
  productSearchQuery,
  searchFetcher,
  setDealForm,
  setProductSearchQuery,
  setShowDealProductSearch,
  showDealProductSearch,
}) {
  return (
    <div style={{ display: activeTab === "hotdeals" ? "block" : "none" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: "20px",
          alignItems: "start",
        }}
      >
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                오늘의 특가 상품 목록 ({config.hotDeals?.length || 0}건)
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                앱에는 단위가격(Grundpreis)과 부가세 포함 표기가 자동으로
                붙습니다.
              </Text>
              <Divider />

              <BlockStack gap="300">
                {(config.hotDeals || []).map((deal, idx) => {
                  const submit = (fields) => {
                    const fd = new FormData();
                    for (const [k, v] of Object.entries(fields))
                      fd.append(k, v);
                    fetcher.submit(fd, { method: "post" });
                  };
                  const live = liveVariantPrices[deal.variantId];
                  // Admin state and the real Shopify price can drift (failed sync, edits in Shopify).
                  const notOnShopify = deal.isActive && live && Math.abs(live.price - Number(deal.salePrice)) > 0.005;
                  return (
                    <AdminListRow
                      key={deal.id}
                      thumb={deal.image}
                      active={deal.isActive}
                      badges={[
                        {
                          label: deal.isActive ? "진행 중" : "중지",
                          tone: deal.isActive ? "success" : undefined,
                        },
                        { label: `-${deal.discountRate}%`, tone: "critical" },
                        ...(deal.badge?.ko ? [{ label: deal.badge.ko }] : []),
                        ...(deal.mhdDate
                          ? [{ label: `MHD ${deal.mhdDate}`, tone: "warning" }]
                          : []),
                        ...(notOnShopify ? [{ label: "Shopify 미반영", tone: "critical" }] : []),
                      ]}
                      title={deal.name?.ko || "상품명 없음"}
                      subtitle={`€${Number(deal.basePrice).toFixed(2)} → €${Number(deal.salePrice).toFixed(2)}${live ? ` · 현재 Shopify 판매가 €${live.price.toFixed(2)}` : ""}`}
                      isFirst={idx === 0}
                      isLast={idx === (config.hotDeals || []).length - 1}
                      onMove={(direction) =>
                        submit({
                          intent: "reorder_deal",
                          dealId: deal.id,
                          direction,
                        })
                      }
                      actions={[
                        { label: "수정", onClick: () => handleEditDeal(deal) },
                        {
                          label: deal.isActive ? "중지" : "시작",
                          confirm: deal.isActive
                            ? "특가를 중지하면 Shopify 판매가가 할인 전 정상가로 돌아갑니다."
                            : `Shopify 판매가가 €${Number(deal.salePrice).toFixed(2)}로 바뀝니다.`,
                          onClick: () =>
                            submit({
                              intent: "toggle_hot_deal",
                              dealId: deal.id,
                            }),
                        },
                        {
                          label: "삭제",
                          tone: "critical",
                          confirm: `'${deal.name?.ko || "이 특가"}' 특가를 삭제할까요?`,
                          onClick: () =>
                            submit({
                              intent: "delete_hot_deal",
                              dealId: deal.id,
                            }),
                        },
                      ]}
                    />
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Shopify Product Quick Search */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                쇼피파이 등록 상품 검색으로 빠른 불러오기
              </Text>
              <InlineStack gap="200">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="상품명 또는 SKU 검색"
                    labelHidden
                    placeholder="예: 신라면, 김치, 만두 입력 후 검색"
                    value={productSearchQuery}
                    onChange={setProductSearchQuery}
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && productSearchQuery.trim()) {
                        e.preventDefault();
                        const fd = new FormData();
                        fd.append("intent", "search_shopify_products");
                        fd.append("query", productSearchQuery);
                        searchFetcher.submit(fd, { method: "post" });
                      }
                    }}
                  />
                </div>
                <Button
                  loading={searchFetcher.state !== "idle"}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "search_shopify_products");
                    fd.append("query", productSearchQuery);
                    searchFetcher.submit(fd, { method: "post" });
                  }}
                >
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
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
                            판매가 €{sp.price.toFixed(2)}
                          </Text>
                        </div>
                      </div>
                      <Button
                        size="slim"
                        variant="primary"
                        onClick={() => handleSelectDealProduct(sp)}
                      >
                        특가 상품으로 선택
                      </Button>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </BlockStack>

        {/* Hot Deal Editor Form */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                {dealForm.dealId ? "특가 상품 수정" : "새 특가 상품 등록"}
              </Text>
              {dealForm.dealId && (
                <Button
                  size="slim"
                  onClick={() => {
                    setDealForm({
                      dealId: "",
                      productId: "",
                      variantId: "",
                      productNameKo: "",
                      productNameDe: "",
                      productNameEn: "",
                      imageUrl: "",
                      basePrice: "6.49",
                      salePrice: "4.79",
                      discountRate: "26",
                      badgeKo: "오늘만 특가",
                      badgeDe: "Tagesdeal",
                      badgeEn: "Daily Deal",
                      isMhdDeal: false,
                      mhdDate: "",
                      sortOrder: String((config.hotDeals?.length || 0) + 1),
                      isActive: true,
                    });
                    setShowDealProductSearch(false);
                  }}
                >
                  신규 등록 모드로 전환
                </Button>
              )}
            </InlineStack>
            <Divider />

            {/* Shopify Product Connection Section */}
            {dealForm.productId && !showDealProductSearch ? (
              <div
                style={{
                  border: "1px solid #10B981",
                  background: "#F0FDF4",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    minWidth: 0,
                  }}
                >
                  {dealForm.imageUrl && (
                    <img
                      src={dealForm.imageUrl}
                      alt=""
                      style={{
                        width: "48px",
                        height: "48px",
                        objectFit: "contain",
                        background: "#FFFFFF",
                        borderRadius: "8px",
                        border: "1px solid #D1D5DB",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <InlineStack gap="150" align="center">
                      <Badge tone="success">Shopify 상품 연동됨</Badge>
                      <span style={{ fontSize: "11px", color: "#065F46" }}>
                        실제 결제 시 특가 자동 적용
                      </span>
                    </InlineStack>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "13px",
                        marginTop: "3px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dealForm.productNameKo}
                    </div>
                  </div>
                </div>
                <Button
                  size="slim"
                  onClick={() => setShowDealProductSearch(true)}
                >
                  다른 상품 검색 / 변경
                </Button>
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #E3E3E3",
                  background: "#FAFAFA",
                  borderRadius: "10px",
                  padding: "14px",
                }}
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" fontWeight="semibold">
                      Shopify 상품 선택 (필수)
                    </Text>
                    {dealForm.productId && (
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => setShowDealProductSearch(false)}
                      >
                        닫기
                      </Button>
                    )}
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued">
                    상품을 선택하면 상품명, 이미지, 정상가가 채워집니다.
                  </Text>

                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="쇼피파이 상품 검색"
                        labelHidden
                        placeholder="신라면, 김치, 만두, SKU 등 입력 후 검색"
                        value={productSearchQuery}
                        onChange={setProductSearchQuery}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      loading={searchFetcher.state !== "idle"}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "search_shopify_products");
                        fd.append("query", productSearchQuery);
                        searchFetcher.submit(fd, { method: "post" });
                      }}
                    >
                      검색
                    </Button>
                  </InlineStack>

                  {searchFetcher.data?.searchedProducts && (
                    <div
                      style={{
                        maxHeight: "220px",
                        overflowY: "auto",
                        border: "1px solid #D1D5DB",
                        borderRadius: "8px",
                        padding: "6px",
                        background: "#FFFFFF",
                      }}
                    >
                      {searchFetcher.data.searchedProducts.length === 0 ? (
                        <div
                          style={{
                            padding: "16px",
                            textAlign: "center",
                            color: "#6B7280",
                            fontSize: "13px",
                          }}
                        >
                          검색 결과가 없습니다.
                        </div>
                      ) : (
                        searchFetcher.data.searchedProducts.map((sp) => (
                          <div
                            key={sp.productId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              borderRadius: "6px",
                              background:
                                dealForm.productId === sp.productId
                                  ? "#EFF6FF"
                                  : "#F9FAFB",
                              border:
                                dealForm.productId === sp.productId
                                  ? "1px solid #3B82F6"
                                  : "1px solid #E5E7EB",
                              marginBottom: "6px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              {sp.imageUrl && (
                                <img
                                  src={sp.imageUrl}
                                  alt=""
                                  style={{
                                    width: "32px",
                                    height: "32px",
                                    objectFit: "contain",
                                  }}
                                />
                              )}
                              <div>
                                <div
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {sp.title}
                                </div>
                                <div
                                  style={{ fontSize: "11px", color: "#6B7280" }}
                                >
                                  판매가 €{sp.price.toFixed(2)}{" "}
                                  {sp.compareAtPrice > sp.price &&
                                    `(정상가 €${sp.compareAtPrice.toFixed(2)})`}
                                </div>
                              </div>
                            </div>
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => handleSelectDealProduct(sp)}
                            >
                              선택
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </BlockStack>
              </div>
            )}

            <TextField
              label="상품명 (한국어 필수)"
              value={dealForm.productNameKo}
              onChange={(v) => setDealForm({ ...dealForm, productNameKo: v })}
              autoComplete="off"
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="상품명 (독일어 - 미입력시 한국어 자동 폴백)"
                  value={dealForm.productNameDe}
                  onChange={(v) =>
                    setDealForm({ ...dealForm, productNameDe: v })
                  }
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="상품명 (영어)"
                  value={dealForm.productNameEn}
                  onChange={(v) =>
                    setDealForm({ ...dealForm, productNameEn: v })
                  }
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <TextField
              label="상품 이미지 URL"
              value={dealForm.imageUrl}
              onChange={(v) => setDealForm({ ...dealForm, imageUrl: v })}
              autoComplete="off"
            />

            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="기존 정상가 (€)"
                  type="number"
                  step="0.01"
                  value={dealForm.basePrice}
                  onChange={handleDealBasePriceChange}
                  helpText="Shopify 등록 기준 원래 판매가"
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="오늘의 특가가 (€)"
                  type="number"
                  step="0.01"
                  value={dealForm.salePrice}
                  onChange={handleDealSalePriceChange}
                  helpText="실제 결제 청구 금액"
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="할인율 표기 (%)"
                  type="number"
                  value={dealForm.discountRate}
                  onChange={handleDealDiscountRateChange}
                  helpText="가격 입력 시 자동 계산"
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <Text variant="bodySm" tone="subdued" as="p">
              저장하면 Shopify 판매가가 특가가로 바뀝니다. 웹 스토어 가격도 같이
              바뀝니다.
            </Text>

            <InlineStack gap="300">
              <div style={{ flex: 1 }}></div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="유통기한 임박 특가(MHD) 날짜 배지 (선택)"
                  placeholder="예: 2026-11-18"
                  value={dealForm.mhdDate || ""}
                  onChange={(v) =>
                    setDealForm({
                      ...dealForm,
                      mhdDate: v,
                      isMhdDeal: Boolean(v),
                    })
                  }
                  helpText="입력 시 앱 상품 카드에 MHD 날짜 배지가 즉시 표시됩니다."
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="강조 뱃지 (예: 오늘만 특가, 한정수량)"
                  value={dealForm.badgeKo}
                  onChange={(v) => setDealForm({ ...dealForm, badgeKo: v })}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="노출 순서"
                  type="number"
                  value={dealForm.sortOrder}
                  onChange={(v) => setDealForm({ ...dealForm, sortOrder: v })}
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <Checkbox
              label="특가 섹션에 즉시 노출"
              checked={dealForm.isActive}
              onChange={(v) => setDealForm({ ...dealForm, isActive: v })}
            />

            <Button
              variant="primary"
              loading={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "save_hot_deal");
                Object.entries(dealForm).forEach(([k, val]) => {
                  fd.append(k, String(val));
                });
                fetcher.submit(fd, { method: "post" });
              }}
            >
              특가 상품 저장 및 모바일 앱 반영
            </Button>
          </BlockStack>
        </Card>
      </div>
    </div>
  );
}
