import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { isoToLocalInput, localInputToIso } from "./shared.jsx";

// "campaigns" tab of the app management screen (moved out of app.app-management.jsx).
export function CampaignsPanel({
  activeGbSearchIdx,
  activeSubSearchIdx,
  campaignSearchFetcher,
  fetcher,
  freeShippingThreshold,
  gbSearchQuery,
  groupBuying,
  isSubmitting,
  livePriceLabel,
  liveVariantPrices,
  prospekt,
  setActiveGbSearchIdx,
  setActiveSubSearchIdx,
  setGbSearchQuery,
  setGroupBuying,
  setSubSearchQuery,
  setSubscriptionPlans,
  shippingNoticeKo,
  subSearchQuery,
  subscriptionPlans,
}) {
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <div>
              <Text variant="headingMd" as="h2">
                공동구매 (Group Buying) 캠페인 관리 ({groupBuying.length}건)
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                쇼피파이 실물 상품을 직접 검색·연결하여 모바일 앱 공동구매
                코너에 노출합니다.
              </Text>
            </div>
            <Button
              variant="primary"
              size="slim"
              onClick={() => {
                const newIdx = groupBuying.length;
                setGroupBuying([
                  ...groupBuying,
                  {
                    id: `gb-${Date.now()}`,
                    productId: "",
                    variantId: "",
                    productTitle: "",
                    keyword: "",
                    titleKo: "신규 공동구매 기획전",
                    titleDe: "Neuer Gruppenkauf Deal",
                    titleEn: "New Group Buy Campaign",
                    descKo: "목표 인원 달성 시 일괄 출고",
                    descDe: "Versand ab Zielerreichung",
                    descEn: "Dispatches upon reaching target participants",
                    regularPrice: 0,
                    targetCount: 20,
                    currentCount: 0,
                    endsAt: "",
                    imageUrl: "",
                    isActive: true,
                    discountCode: "",
                  },
                ]);
                setActiveGbSearchIdx(newIdx);
                setGbSearchQuery("");
              }}
            >
              + 신규 공동구매 캠페인 추가
            </Button>
          </InlineStack>
          <Divider />

          {groupBuying.length === 0 ? (
            <div
              style={{ padding: "24px", textAlign: "center", color: "#6B7280" }}
            >
              등록된 공동구매 캠페인이 없습니다. 상단의 &quot;+ 신규 공동구매
              캠페인 추가&quot; 버튼을 눌러 상품을 연결하세요.
            </div>
          ) : (
            groupBuying.map((gb, idx) => {
              const isProductConnected =
                gb.productId && !String(gb.productId).endsWith("/p1");
              const isSearchOpen = activeGbSearchIdx === idx;

              return (
                <div
                  key={gb.id || idx}
                  style={{
                    border: isProductConnected
                      ? "1px solid #D1D5DB"
                      : "1px dashed #F59E0B",
                    borderRadius: "10px",
                    padding: "16px",
                    background: isProductConnected ? "#FFFFFF" : "#FFFBEB",
                  }}
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge
                          tone={isProductConnected ? "success" : "attention"}
                        >
                          {isProductConnected
                            ? "쇼피파이 상품 연결됨"
                            : "상품 미연결 (선택 필요)"}
                        </Badge>
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                          캠페인 #{idx + 1}:{" "}
                          {gb.titleKo || gb.productTitle || "제목 미설정"}
                        </Text>
                      </InlineStack>
                      <Button
                        size="slim"
                        tone="critical"
                        onClick={() =>
                          setGroupBuying(
                            groupBuying.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        캠페인 삭제
                      </Button>
                    </InlineStack>

                    {/* Linked Shopify Product Card */}
                    <div
                      style={{
                        background: "#F9FAFB",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {gb.imageUrl ? (
                            <img
                              src={gb.imageUrl}
                              alt={gb.productTitle || gb.titleKo}
                              style={{
                                width: "48px",
                                height: "48px",
                                objectFit: "contain",
                                borderRadius: "6px",
                                background: "#FFFFFF",
                                border: "1px solid #E5E7EB",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "48px",
                                height: "48px",
                                background: "#E5E7EB",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                color: "#6B7280",
                                flexShrink: 0,
                              }}
                            >
                              이미지 없음
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <Text
                              variant="bodyMd"
                              fontWeight="bold"
                              as="p"
                              truncate
                            >
                              {gb.productTitle ||
                                (isProductConnected
                                  ? gb.titleKo
                                  : "연결된 쇼피파이 상품이 없습니다.")}
                            </Text>
                            <Text variant="bodySm" tone="subdued" as="p">
                              {isProductConnected
                                ? `Shopify ID: ${gb.productId.split("/").pop()} · ${livePriceLabel(gb)}`
                                : "우측 '쇼피파이 상품 선택' 버튼을 눌러 실제 판매 상품을 연결해주세요."}
                            </Text>
                          </div>
                        </div>
                        <Button
                          size="slim"
                          variant={isSearchOpen ? "secondary" : "primary"}
                          onClick={() => {
                            if (isSearchOpen) {
                              setActiveGbSearchIdx(null);
                            } else {
                              setActiveGbSearchIdx(idx);
                              setGbSearchQuery(
                                gb.keyword ||
                                  (gb.productTitle
                                    ? gb.productTitle.slice(0, 8)
                                    : ""),
                              );
                            }
                          }}
                        >
                          {isSearchOpen
                            ? "검색창 닫기"
                            : isProductConnected
                              ? "상품 변경하기"
                              : "쇼피파이 상품 선택"}
                        </Button>
                      </InlineStack>

                      {/* Search Product Box (Opened when clicking select/change) */}
                      {isSearchOpen && (
                        <div
                          style={{
                            marginTop: "12px",
                            paddingTop: "12px",
                            borderTop: "1px dashed #D1D5DB",
                          }}
                        >
                          <BlockStack gap="300">
                            <InlineStack gap="200">
                              <div style={{ flex: 1 }}>
                                <TextField
                                  label="쇼피파이 등록 상품명 또는 SKU 검색"
                                  labelHidden
                                  placeholder="예: 종가집, 총각김치, 라면, 비비고 만두 등 검색어 입력"
                                  value={gbSearchQuery}
                                  onChange={setGbSearchQuery}
                                  autoComplete="off"
                                />
                              </div>
                              <Button
                                loading={campaignSearchFetcher.state !== "idle"}
                                onClick={() => {
                                  const fd = new FormData();
                                  fd.append(
                                    "intent",
                                    "search_shopify_products",
                                  );
                                  fd.append("query", gbSearchQuery);
                                  campaignSearchFetcher.submit(fd, {
                                    method: "post",
                                  });
                                }}
                              >
                                쇼피파이 상품 검색
                              </Button>
                            </InlineStack>

                            {campaignSearchFetcher.data?.searchedProducts && (
                              <div
                                style={{
                                  maxHeight: "240px",
                                  overflowY: "auto",
                                  border: "1px solid #D1D5DB",
                                  borderRadius: "8px",
                                  padding: "6px",
                                  background: "#FFFFFF",
                                }}
                              >
                                <BlockStack gap="150">
                                  {campaignSearchFetcher.data.searchedProducts
                                    .length === 0 ? (
                                    <div
                                      style={{
                                        padding: "16px",
                                        textAlign: "center",
                                        color: "#6B7280",
                                        fontSize: "13px",
                                      }}
                                    >
                                      검색 결과가 없습니다. 다른 검색어로
                                      검색해보세요.
                                    </div>
                                  ) : (
                                    campaignSearchFetcher.data.searchedProducts.map(
                                      (sp) => (
                                        <div
                                          key={sp.productId}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "8px 12px",
                                            borderRadius: "6px",
                                            background:
                                              gb.productId === sp.productId
                                                ? "#EFF6FF"
                                                : "#F9FAFB",
                                            border:
                                              gb.productId === sp.productId
                                                ? "1px solid #3B82F6"
                                                : "1px solid #E5E7EB",
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "10px",
                                              minWidth: 0,
                                              flex: 1,
                                            }}
                                          >
                                            {sp.imageUrl && (
                                              <img
                                                src={sp.imageUrl}
                                                alt=""
                                                style={{
                                                  width: "36px",
                                                  height: "36px",
                                                  objectFit: "contain",
                                                  borderRadius: "4px",
                                                }}
                                              />
                                            )}
                                            <div style={{ minWidth: 0 }}>
                                              <Text
                                                variant="bodySm"
                                                fontWeight="bold"
                                                as="p"
                                                truncate
                                              >
                                                {sp.title}
                                              </Text>
                                              <Text
                                                variant="bodyXs"
                                                tone="subdued"
                                                as="p"
                                              >
                                                정상 판매가: €
                                                {sp.price.toFixed(2)} · SKU:{" "}
                                                {sp.sku || "-"}
                                              </Text>
                                            </div>
                                          </div>
                                          <Button
                                            size="slim"
                                            variant="primary"
                                            onClick={() => {
                                              const next = [...groupBuying];
                                              next[idx] = {
                                                ...next[idx],
                                                productId: sp.productId,
                                                variantId: sp.variantId,
                                                productTitle: sp.title,
                                                imageUrl: sp.imageUrl,
                                                regularPrice: sp.price,
                                                keyword: sp.title,
                                                titleKo:
                                                  next[idx].titleKo &&
                                                  !next[idx].titleKo.includes(
                                                    "신규 공동구매",
                                                  )
                                                    ? next[idx].titleKo
                                                    : `${sp.title} 기획 공동구매`,
                                              };
                                              setGroupBuying(next);
                                              setActiveGbSearchIdx(null);
                                            }}
                                          >
                                            이 상품으로 연결
                                          </Button>
                                        </div>
                                      ),
                                    )
                                  )}
                                </BlockStack>
                              </div>
                            )}
                          </BlockStack>
                        </div>
                      )}
                    </div>

                    {/* Editable Campaign Meta Fields */}
                    <InlineStack gap="300">
                      <div style={{ flex: 2 }}>
                        <TextField
                          label="공동구매 타이틀 (한국어)"
                          value={gb.titleKo || ""}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = { ...next[idx], titleKo: v };
                            setGroupBuying(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="검색 보조 키워드"
                          value={gb.keyword || ""}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = { ...next[idx], keyword: v };
                            setGroupBuying(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Shopify 할인 코드 (선택 - 결제 시 자동 적용)"
                          value={gb.discountCode || ""}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = { ...next[idx], discountCode: v.trim().toUpperCase() };
                            setGroupBuying(next);
                          }}
                          placeholder="예: GB-KIMCHI-20"
                          helpText="Shopify Admin에서 생성한 할인 코드를 입력하면 고객이 장바구니에서 결제할 때 자동으로 할인가가 적용됩니다."
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <Banner tone="info">
                      앱에는 Shopify 판매가
                      {gb.variantId && liveVariantPrices[gb.variantId]
                        ? ` (현재 €${liveVariantPrices[gb.variantId].price.toFixed(2)})`
                        : ""}
                      가 기본 표시됩니다. 결제창 할인은 Shopify Admin에서 상품 판매가를 직접 변경하거나, 위 &apos;Shopify 할인 코드&apos;를 입력해 두면 결제 시 자동으로 할인가가 적용됩니다.
                    </Banner>

                    <InlineStack gap="300" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="종료 일시 (비우면 종료 없음)"
                          type="datetime-local"
                          value={isoToLocalInput(gb.endsAt)}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = {
                              ...next[idx],
                              endsAt: localInputToIso(v),
                            };
                            delete next[idx].endsInHours;
                            setGroupBuying(next);
                          }}
                          helpText={
                            !gb.endsAt && gb.endsInHours
                              ? "이전 '남은 시간' 값은 앱에 반영되지 않았습니다. 종료 일시를 지정해 주세요."
                              : undefined
                          }
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1, paddingBottom: "6px" }}>
                        <Checkbox
                          label="앱에 노출"
                          checked={gb.isActive !== false}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = { ...next[idx], isActive: v };
                            setGroupBuying(next);
                          }}
                        />
                      </div>
                    </InlineStack>

                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="목표 인원(명)"
                          type="number"
                          value={String(gb.targetCount ?? "")}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = {
                              ...next[idx],
                              targetCount: v === "" ? null : Number(v),
                            };
                            setGroupBuying(next);
                          }}
                          helpText="비우면 앱에 참여 현황을 표시하지 않습니다."
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="현재 참여 인원(명)"
                          type="number"
                          helpText="앱에 그대로 표시됩니다. 실제 주문 수로 입력해 주세요."
                          value={String(gb.currentCount ?? 0)}
                          onChange={(v) => {
                            const next = [...groupBuying];
                            next[idx] = {
                              ...next[idx],
                              currentCount: Number(v || 0),
                            };
                            setGroupBuying(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>
                  </BlockStack>
                </div>
              );
            })
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <div>
              <Text variant="headingMd" as="h2">
                정기배송 구독 박스 (Subscription Plans) 관리 (
                {subscriptionPlans.length}건)
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                쇼피파이 실물 상품/패키지를 검색하여 정기구독 플랜에 연결할 수
                있습니다.
              </Text>
            </div>
            <Button
              variant="primary"
              size="slim"
              onClick={() => {
                const newIdx = subscriptionPlans.length;
                setSubscriptionPlans([
                  ...subscriptionPlans,
                  {
                    id: `sub-${Date.now()}`,
                    productId: "",
                    variantId: "",
                    productTitle: "",
                    titleKo: "신규 정기구독 플랜",
                    titleDe: "Neues Abo-Paket",
                    titleEn: "New Subscription Plan",
                    descKo: "매월 신선 정기 배송 (정기구독 10% 자동 할인)",
                    descDe: "Monatliche Frische-Lieferung mit 10% Abo-Rabatt",
                    descEn:
                      "Monthly fresh delivery with 10% subscription discount",
                    price: 19.9,
                    badgeKo: "정기구독 10% 할인",
                    badgeDe: "10% RABATT",
                    badgeEn: "10% OFF",
                    imageUrl: "",
                    isActive: true,
                  },
                ]);
                setActiveSubSearchIdx(newIdx);
                setSubSearchQuery("");
              }}
            >
              + 신규 구독 플랜 추가
            </Button>
          </InlineStack>
          <Divider />

          {subscriptionPlans.length === 0 ? (
            <div
              style={{ padding: "24px", textAlign: "center", color: "#6B7280" }}
            >
              등록된 정기배송 구독 플랜이 없습니다. 상단의 &quot;+ 신규 구독
              플랜 추가&quot; 버튼을 눌러 상품을 연결하세요.
            </div>
          ) : (
            subscriptionPlans.map((plan, idx) => {
              const isProductConnected =
                plan.productId && !String(plan.productId).endsWith("/0");
              const isSearchOpen = activeSubSearchIdx === idx;

              return (
                <div
                  key={plan.id || idx}
                  style={{
                    border: isProductConnected
                      ? "1px solid #D1D5DB"
                      : "1px dashed #F59E0B",
                    borderRadius: "10px",
                    padding: "16px",
                    background: isProductConnected ? "#FFFFFF" : "#FFFBEB",
                  }}
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge
                          tone={isProductConnected ? "success" : "attention"}
                        >
                          {isProductConnected
                            ? "쇼피파이 상품 연결됨"
                            : "상품 미연결 (선택 필요)"}
                        </Badge>
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                          플랜 #{idx + 1}:{" "}
                          {plan.titleKo || plan.productTitle || "플랜명 미설정"}
                        </Text>
                      </InlineStack>
                      <Button
                        size="slim"
                        tone="critical"
                        onClick={() =>
                          setSubscriptionPlans(
                            subscriptionPlans.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        플랜 삭제
                      </Button>
                    </InlineStack>

                    {/* Linked Shopify Product Card */}
                    <div
                      style={{
                        background: "#F9FAFB",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {plan.imageUrl ? (
                            <img
                              src={plan.imageUrl}
                              alt={plan.productTitle || plan.titleKo}
                              style={{
                                width: "48px",
                                height: "48px",
                                objectFit: "contain",
                                borderRadius: "6px",
                                background: "#FFFFFF",
                                border: "1px solid #E5E7EB",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "48px",
                                height: "48px",
                                background: "#E5E7EB",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                color: "#6B7280",
                                flexShrink: 0,
                              }}
                            >
                              이미지 없음
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <Text
                              variant="bodyMd"
                              fontWeight="bold"
                              as="p"
                              truncate
                            >
                              {plan.productTitle ||
                                (isProductConnected
                                  ? plan.titleKo
                                  : "연결된 쇼피파이 상품이 없습니다.")}
                            </Text>
                            <Text variant="bodySm" tone="subdued" as="p">
                              {isProductConnected
                                ? `Shopify ID: ${plan.productId.split("/").pop()} · 정가: €${Number(plan.price || 0).toFixed(2)}`
                                : "우측 '쇼피파이 상품 선택' 버튼을 눌러 실제 판매 상품을 연결해주세요."}
                            </Text>
                          </div>
                        </div>
                        <Button
                          size="slim"
                          variant={isSearchOpen ? "secondary" : "primary"}
                          onClick={() => {
                            if (isSearchOpen) {
                              setActiveSubSearchIdx(null);
                            } else {
                              setActiveSubSearchIdx(idx);
                              setSubSearchQuery(
                                plan.productTitle
                                  ? plan.productTitle.slice(0, 8)
                                  : "",
                              );
                            }
                          }}
                        >
                          {isSearchOpen
                            ? "검색창 닫기"
                            : isProductConnected
                              ? "상품 변경하기"
                              : "쇼피파이 상품 선택"}
                        </Button>
                      </InlineStack>

                      {/* Search Product Box (Opened when clicking select/change) */}
                      {isSearchOpen && (
                        <div
                          style={{
                            marginTop: "12px",
                            paddingTop: "12px",
                            borderTop: "1px dashed #D1D5DB",
                          }}
                        >
                          <BlockStack gap="300">
                            <InlineStack gap="200">
                              <div style={{ flex: 1 }}>
                                <TextField
                                  label="쇼피파이 등록 상품명 또는 SKU 검색"
                                  labelHidden
                                  placeholder="예: 김치, 라면 박스, 정기배송 패키지 등 검색어 입력"
                                  value={subSearchQuery}
                                  onChange={setSubSearchQuery}
                                  autoComplete="off"
                                />
                              </div>
                              <Button
                                loading={campaignSearchFetcher.state !== "idle"}
                                onClick={() => {
                                  const fd = new FormData();
                                  fd.append(
                                    "intent",
                                    "search_shopify_products",
                                  );
                                  fd.append("query", subSearchQuery);
                                  campaignSearchFetcher.submit(fd, {
                                    method: "post",
                                  });
                                }}
                              >
                                쇼피파이 상품 검색
                              </Button>
                            </InlineStack>

                            {campaignSearchFetcher.data?.searchedProducts && (
                              <div
                                style={{
                                  maxHeight: "240px",
                                  overflowY: "auto",
                                  border: "1px solid #D1D5DB",
                                  borderRadius: "8px",
                                  padding: "6px",
                                  background: "#FFFFFF",
                                }}
                              >
                                <BlockStack gap="150">
                                  {campaignSearchFetcher.data.searchedProducts
                                    .length === 0 ? (
                                    <div
                                      style={{
                                        padding: "16px",
                                        textAlign: "center",
                                        color: "#6B7280",
                                        fontSize: "13px",
                                      }}
                                    >
                                      검색 결과가 없습니다. 다른 검색어로
                                      검색해보세요.
                                    </div>
                                  ) : (
                                    campaignSearchFetcher.data.searchedProducts.map(
                                      (sp) => (
                                        <div
                                          key={sp.productId}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "8px 12px",
                                            borderRadius: "6px",
                                            background:
                                              plan.productId === sp.productId
                                                ? "#EFF6FF"
                                                : "#F9FAFB",
                                            border:
                                              plan.productId === sp.productId
                                                ? "1px solid #3B82F6"
                                                : "1px solid #E5E7EB",
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "10px",
                                              minWidth: 0,
                                              flex: 1,
                                            }}
                                          >
                                            {sp.imageUrl && (
                                              <img
                                                src={sp.imageUrl}
                                                alt=""
                                                style={{
                                                  width: "36px",
                                                  height: "36px",
                                                  objectFit: "contain",
                                                  borderRadius: "4px",
                                                }}
                                              />
                                            )}
                                            <div style={{ minWidth: 0 }}>
                                              <Text
                                                variant="bodySm"
                                                fontWeight="bold"
                                                as="p"
                                                truncate
                                              >
                                                {sp.title}
                                              </Text>
                                              <Text
                                                variant="bodyXs"
                                                tone="subdued"
                                                as="p"
                                              >
                                                단품 판매가: €
                                                {sp.price.toFixed(2)} · SKU:{" "}
                                                {sp.sku || "-"}
                                              </Text>
                                            </div>
                                          </div>
                                          <Button
                                            size="slim"
                                            variant="primary"
                                            onClick={() => {
                                              const next = [
                                                ...subscriptionPlans,
                                              ];
                                              const regular = sp.price;
                                              next[idx] = {
                                                ...next[idx],
                                                productId: sp.productId,
                                                variantId: sp.variantId,
                                                productTitle: sp.title,
                                                imageUrl: sp.imageUrl,
                                                price:
                                                  next[idx].price &&
                                                  next[idx].price > 0
                                                    ? next[idx].price
                                                    : Number(
                                                        (regular * 0.9).toFixed(
                                                          2,
                                                        ),
                                                      ),
                                                titleKo:
                                                  next[idx].titleKo &&
                                                  !next[idx].titleKo.includes(
                                                    "신규 정기구독",
                                                  )
                                                    ? next[idx].titleKo
                                                    : `${sp.title} 정기배송`,
                                                titleDe:
                                                  next[idx].titleDe ||
                                                  `${sp.title} Abo-Paket`,
                                                titleEn:
                                                  next[idx].titleEn ||
                                                  `${sp.title} Subscription Box`,
                                                descKo:
                                                  next[idx].descKo ||
                                                  "매월 신선 정기 배송 (정기구독 10% 자동 할인)",
                                                descDe:
                                                  next[idx].descDe ||
                                                  "Monatliche Frische-Lieferung mit 10% Abo-Rabatt",
                                                descEn:
                                                  next[idx].descEn ||
                                                  "Monthly fresh delivery with 10% subscription discount",
                                                badgeKo:
                                                  next[idx].badgeKo ||
                                                  "정기구독 10% 할인",
                                              };
                                              setSubscriptionPlans(next);
                                              setActiveSubSearchIdx(null);
                                            }}
                                          >
                                            이 상품으로 연결
                                          </Button>
                                        </div>
                                      ),
                                    )
                                  )}
                                </BlockStack>
                              </div>
                            )}
                          </BlockStack>
                        </div>
                      )}
                    </div>

                    {/* Editable Fields */}
                    <InlineStack gap="300">
                      <div style={{ flex: 2 }}>
                        <TextField
                          label="구독 플랜명 (한국어)"
                          value={plan.titleKo || ""}
                          onChange={(v) => {
                            const next = [...subscriptionPlans];
                            next[idx] = { ...next[idx], titleKo: v };
                            setSubscriptionPlans(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="월 구독가 (€)"
                          type="number"
                          step="0.1"
                          value={String(plan.price ?? 19.9)}
                          onChange={(v) => {
                            const next = [...subscriptionPlans];
                            next[idx] = {
                              ...next[idx],
                              price: Number(v || 0),
                            };
                            setSubscriptionPlans(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="강조 배지"
                          value={plan.badgeKo || ""}
                          onChange={(v) => {
                            const next = [...subscriptionPlans];
                            next[idx] = { ...next[idx], badgeKo: v };
                            setSubscriptionPlans(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="플랜명 (독일어)"
                          value={plan.titleDe || ""}
                          onChange={(v) => {
                            const next = [...subscriptionPlans];
                            next[idx] = { ...next[idx], titleDe: v };
                            setSubscriptionPlans(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="플랜명 (영어)"
                          value={plan.titleEn || ""}
                          onChange={(v) => {
                            const next = [...subscriptionPlans];
                            next[idx] = { ...next[idx], titleEn: v };
                            setSubscriptionPlans(next);
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <TextField
                      label="구독 안내/혜택 설명 (한국어)"
                      value={plan.descKo || ""}
                      onChange={(v) => {
                        const next = [...subscriptionPlans];
                        next[idx] = { ...next[idx], descKo: v };
                        setSubscriptionPlans(next);
                      }}
                      placeholder="예: 매월 신선 정기 배송 (정기구독 10% 자동 할인)"
                      autoComplete="off"
                    />
                  </BlockStack>
                </div>
              );
            })
          )}

          <Button
            variant="primary"
            loading={isSubmitting}
            onClick={() => {
              const fd = new FormData();
              fd.append("intent", "save_store_config");
              fd.append("freeShippingThreshold", freeShippingThreshold);
              fd.append("shippingNoticeKo", shippingNoticeKo);
              fd.append("groupBuyingJson", JSON.stringify(groupBuying));
              fd.append("prospektJson", JSON.stringify(prospekt));
              fd.append(
                "subscriptionPlansJson",
                JSON.stringify(subscriptionPlans),
              );
              fetcher.submit(fd, { method: "post" });
            }}
          >
            공동구매 · 정기구독 설정 저장 및 앱 반영
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
