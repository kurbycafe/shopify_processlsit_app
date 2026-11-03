import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import ProductAttributesManager from "../ProductAttributesManager.jsx";

// "product-attributes" tab of the app management screen (moved out of app.app-management.jsx).
export function ProductAttributesPanel({
  activeTab,
  fetcher,
  handleEditOverride,
  isSubmitting,
  overrideForm,
  productRules,
  productSearchQuery,
  revalidator,
  searchFetcher,
  setOverrideForm,
  setProductSearchQuery,
  setShowLegacyRules,
  showLegacyRules,
}) {
  return (
    <div
      style={{ display: activeTab === "product-attributes" ? "block" : "none" }}
    >
      <BlockStack gap="400">
        <ProductAttributesManager
          onSaved={() => {
            void revalidator.revalidate();
          }}
        />
        <Button onClick={() => setShowLegacyRules((value) => !value)}>
          {showLegacyRules
            ? "기존 수동 설정 닫기"
            : "기존 수동 설정 관리 (미연결 상품 포함)"}
        </Button>
        {showLegacyRules && (
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
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">
                      MHD 임박특가 · 상품 속성 목록 ({productRules.length}건)
                    </Text>
                    <Button
                      size="slim"
                      onClick={() =>
                        setOverrideForm({
                          overrideId: "",
                          productId: "",
                          sku: "",
                          keyword: "",
                          productNameKo: "",
                          productNameDe: "",
                          productNameEn: "",
                          imageUrl: "",
                          isMhdDeal: false,
                          mhdDate: "",
                          mhdPrice: "",
                          isCartFiller: false,
                          ageRestriction: "",
                          pfand: "0",
                          bundleBadgeKo: "",
                          bundleBadgeDe: "",
                          bundleBadgeEn: "",
                          isUpcomingDeal: false,
                          upcomingDateKo: "",
                          upcomingDateDe: "",
                          upcomingDateEn: "",
                        })
                      }
                    >
                      신규 상품 속성 추가
                    </Button>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    MHD 날짜·추천·연령 제한·보증금 등 상품 속성을 관리합니다.
                    보관 온도는 상단 상품 온도 관리에서 별도로 설정하며, 여기서
                    속성을 저장해도 지정한 온도는 유지됩니다.
                  </Text>
                  <Divider />

                  <BlockStack gap="300">
                    {productRules.map((po) => (
                      <div
                        key={po.id}
                        style={{
                          border: "1px solid #E5E7EB",
                          borderRadius: "10px",
                          padding: "14px",
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                          background: "#FFFFFF",
                        }}
                      >
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "8px",
                            background: "#F4F5F7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          {po.imageUrl && (
                            <img
                              src={po.imageUrl}
                              alt={po.productNameKo}
                              style={{
                                width: "85%",
                                height: "85%",
                                objectFit: "contain",
                                mixBlendMode: "multiply",
                              }}
                            />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "6px",
                              marginBottom: "4px",
                            }}
                          >
                            {po.isMhdDeal && po.mhdDate && (
                              <Badge tone="critical">{`MHD ${po.mhdDate}`}</Badge>
                            )}
                            {po.isCartFiller && (
                              <Badge tone="success">무료배송 채우기 추천</Badge>
                            )}
                            {po.isUpcomingDeal && (
                              <Badge tone="info">
                                {`오픈예정 (${po.upcomingDateKo || "예정"})`}
                              </Badge>
                            )}
                            {po.ageRestriction && (
                              <Badge tone="critical">{`연령 ${po.ageRestriction}`}</Badge>
                            )}
                            {Number(po.pfand) > 0 && (
                              <Badge>{`Pfand €${Number(po.pfand).toFixed(2)}`}</Badge>
                            )}
                          </div>
                          <Text variant="bodyMd" fontWeight="bold" as="p">
                            {po.productNameKo}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            매칭 키워드: {po.keyword || "-"}
                            {po.mhdPrice
                              ? ` · 임박특가가 €${Number(po.mhdPrice).toFixed(2)}`
                              : ""}
                            {po.bundleBadgeKo
                              ? ` · 배지: ${po.bundleBadgeKo}`
                              : ""}
                          </Text>
                        </div>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => handleEditOverride(po)}
                          >
                            수정
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete_product_override");
                              fd.append("overrideId", po.id);
                              fetcher.submit(fd, { method: "post" });
                            }}
                          >
                            삭제
                          </Button>
                        </InlineStack>
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Shopify Product Search for Per-Product Override */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Shopify 상품 검색 후 MHD·속성 설정 불러오기
                  </Text>
                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="상품명 또는 SKU 검색"
                        labelHidden
                        placeholder="예: 김치, 만두, 라면, 소주 입력 후 검색"
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
                                SKU: {sp.sku || "-"} · 판매가 €
                                {sp.price.toFixed(2)}
                              </Text>
                            </div>
                          </div>
                          <Button
                            size="slim"
                            onClick={() => {
                              setOverrideForm({
                                ...overrideForm,
                                overrideId: "",
                                productId: sp.productId,
                                sku: sp.sku || "",
                                keyword: sp.title.split(" ")[0],
                                productNameKo: sp.title,
                                imageUrl: sp.imageUrl,
                                mhdPrice: String(sp.price),
                              });
                            }}
                          >
                            이 상품 설정하기
                          </Button>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>

            {/* Per-Product Override Form */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {overrideForm.overrideId
                    ? "MHD · 상품 속성 수정"
                    : "새 MHD · 상품 속성 등록"}
                </Text>
                <Divider />

                <TextField
                  label="대상 상품명 (한국어 필수)"
                  value={overrideForm.productNameKo}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, productNameKo: v })
                  }
                  placeholder="예: 종가집 맛김치 500g"
                  autoComplete="off"
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="매칭 키워드 (상품명 포함 단어)"
                      value={overrideForm.keyword}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, keyword: v })
                      }
                      placeholder="예: 김치, 만두, 신라면"
                      helpText="상품 ID 또는 키워드가 일치하는 모든 모바일 상품에 자동 적용됩니다."
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="SKU 또는 Product ID (선택)"
                      value={overrideForm.productId}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, productId: v })
                      }
                      placeholder="gid://shopify/Product/..."
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="상품 대표 이미지 URL"
                  value={overrideForm.imageUrl}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, imageUrl: v })
                  }
                  autoComplete="off"
                />

                <Divider />
                <Text variant="headingSm" as="h3">
                  유통기한 임박 특가 (MHD-Deal) 설정
                </Text>

                <Checkbox
                  label="이 상품을 유통기한 임박 특가(MHD-Deal)로 지정 및 날짜 배지 노출"
                  checked={overrideForm.isMhdDeal}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isMhdDeal: v })
                  }
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="유통기한(MHD) 표기 날짜"
                      placeholder="예: 2026-11-18"
                      value={overrideForm.mhdDate}
                      onChange={(v) =>
                        setOverrideForm({
                          ...overrideForm,
                          mhdDate: v,
                          isMhdDeal: Boolean(v) || overrideForm.isMhdDeal,
                        })
                      }
                      helpText="상품 카드 좌상단 및 상세페이지에 'MHD 2026-11-18' 배지로 노출됩니다."
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="임박 특가 할인가 (€ - 선택)"
                      type="number"
                      step="0.01"
                      value={overrideForm.mhdPrice}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, mhdPrice: v })
                      }
                      placeholder="예: 3.90"
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Divider />
                <Text variant="headingSm" as="h3">
                  장바구니 추천 · 오픈예정 · 독일 법규(JuSchG / Pfand) 속성
                </Text>

                <Checkbox
                  label="장바구니 '무료배송 금액 채우기' 인라인 슬라이더 우선 추천 상품으로 지정"
                  checked={overrideForm.isCartFiller}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isCartFiller: v })
                  }
                />

                <Checkbox
                  label="특가 탭 '[오픈예정]' 코너에 노출"
                  checked={overrideForm.isUpcomingDeal}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isUpcomingDeal: v })
                  }
                />

                {overrideForm.isUpcomingDeal && (
                  <TextField
                    label="오픈예정 안내 문구 (한국어)"
                    placeholder="예: 월요일 10:00 특가 오픈"
                    value={overrideForm.upcomingDateKo}
                    onChange={(v) =>
                      setOverrideForm({ ...overrideForm, upcomingDateKo: v })
                    }
                    autoComplete="off"
                  />
                )}

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="독일 청소년보호법(JuSchG) 연령제한 배지"
                      options={[
                        { label: "연령 제한 없음", value: "" },
                        { label: "16세 이상 (16+ 맥주/발효주)", value: "16+" },
                        { label: "18세 이상 (18+ 소주/증류주)", value: "18+" },
                      ]}
                      value={overrideForm.ageRestriction}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, ageRestriction: v })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Select
                      label="독일 공병 보증금 (Pfand)"
                      options={[
                        { label: "Pfand 없음 (€0.00)", value: "0" },
                        {
                          label: "일회용 캔/페트 (€0.25 Pfand)",
                          value: "0.25",
                        },
                      ]}
                      value={String(overrideForm.pfand || "0")}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, pfand: v })
                      }
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="추가 번들/안내 배지 문구 (한국어 - 선택)"
                  placeholder="예: 아이스팩 무상동봉, 5입 멀티팩 특가"
                  value={overrideForm.bundleBadgeKo}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, bundleBadgeKo: v })
                  }
                  autoComplete="off"
                />

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_product_override");
                    Object.entries(overrideForm).forEach(([k, val]) => {
                      fd.append(k, String(val));
                    });
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  MHD · 상품 속성 저장
                </Button>
              </BlockStack>
            </Card>
          </div>
        )}
      </BlockStack>
    </div>
  );
}
