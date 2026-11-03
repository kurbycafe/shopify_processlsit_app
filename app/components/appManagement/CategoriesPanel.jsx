import {
  ALLOWED_CATEGORY_ICONS,
  AdminListRow,
  CategoryVectorIcon,
} from "./shared.jsx";
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

// "categories" tab of the app management screen (moved out of app.app-management.jsx).
export function CategoriesPanel({
  brandAutoFilterFetcher,
  brandForm,
  brandProductSearchQuery,
  brandSearchFetcher,
  catAutoFilterFetcher,
  catForm,
  catProductSearchQuery,
  catSearchFetcher,
  categorySubTab,
  config,
  fetcher,
  handleEditBrand,
  handleEditCategory,
  handleNewBrand,
  handleNewCategory,
  isSubmitting,
  onlineProductTypes,
  onlineProductTypesLoading,
  setBrandForm,
  setBrandProductSearchQuery,
  setCatForm,
  setCatProductSearchQuery,
  setCategorySubTab,
  triggerBrandAutoFilter,
  triggerCatAutoFilter,
}) {
  return (
    <BlockStack gap="400">
      {/* Sub-tab Navigation: Categories vs Brands */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          background: "#FFFFFF",
          padding: "10px 16px",
          borderRadius: "12px",
          border: "1px solid #E5E7EB",
        }}
      >
        <Button
          variant={categorySubTab === "categories" ? "primary" : "secondary"}
          onClick={() => setCategorySubTab("categories")}
        >
          카테고리 및 상단 GNB ({config.categories?.length || 0})
        </Button>
        <Button
          variant={categorySubTab === "brands" ? "primary" : "secondary"}
          onClick={() => setCategorySubTab("brands")}
        >
          인기 브랜드 및 브랜드별 상품 ({config.brands?.length || 0})
        </Button>
      </div>

      {/* Sub-tab 1: Categories */}
      {categorySubTab === "categories" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Left Card: Category List */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  카테고리 및 상단 GNB 탭 목록 ({config.categories?.length || 0}
                  개)
                </Text>
                <Button size="slim" onClick={handleNewCategory}>
                  + 새 카테고리 추가
                </Button>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                {(config.categories || []).map((cat, idx) => {
                  const submit = (fields) => {
                    const fd = new FormData();
                    for (const [k, v] of Object.entries(fields))
                      fd.append(k, v);
                    fetcher.submit(fd, { method: "post" });
                  };
                  const assigned = cat.assignedProducts?.length || 0;
                  return (
                    <AdminListRow
                      key={cat.id}
                      thumbNode={
                        <CategoryVectorIcon name={cat.iconName} size={22} />
                      }
                      active={cat.isActive !== false}
                      selected={catForm.categoryId === cat.id}
                      badges={[
                        ...(cat.isGnbTab
                          ? [{ label: "상단 탭", tone: "info" }]
                          : []),
                        ...(cat.isCarousel ? [{ label: "홈 아이콘" }] : []),
                        ...(cat.badgeTag
                          ? [{ label: cat.badgeTag, tone: "critical" }]
                          : []),
                      ]}
                      title={`${cat.name?.ko || cat.categoryKey}`}
                      subtitle={`${cat.categoryKey} · ${assigned > 0 ? `지정 상품 ${assigned}개` : "키워드 자동 매칭"}`}
                      isFirst={idx === 0}
                      isLast={idx === (config.categories || []).length - 1}
                      onMove={(direction) =>
                        submit({
                          intent: "reorder_category",
                          categoryId: cat.id,
                          direction,
                        })
                      }
                      actions={[
                        {
                          label: "수정",
                          onClick: () => handleEditCategory(cat),
                        },
                        ...(cat.categoryKey !== "all"
                          ? [
                              {
                                label: "삭제",
                                tone: "critical",
                                confirm: `'${cat.name?.ko || cat.categoryKey}' 카테고리를 삭제할까요?`,
                                onClick: () =>
                                  submit({
                                    intent: "delete_category",
                                    categoryId: cat.id,
                                    categoryKey: cat.categoryKey,
                                  }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Right Card: Category Edit & Product Picker */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  {catForm.categoryId
                    ? "카테고리 상세 수정"
                    : "새 카테고리 추가"}
                </Text>
                {catForm.categoryId && (
                  <Button size="slim" onClick={handleNewCategory}>
                    새 카테고리 등록으로 전환
                  </Button>
                )}
              </InlineStack>
              <Divider />
              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="카테고리 키 (영문 소문자)"
                    value={catForm.categoryKey}
                    onChange={(v) => setCatForm({ ...catForm, categoryKey: v })}
                    placeholder="예: ramyun, kimchi, frozen"
                    helpText="새 키는 아래에서 상품을 지정하거나 같은 핸들의 Shopify 컬렉션이 있어야 정확히 표시됩니다. 둘 다 없으면 앱이 카테고리 이름으로 상품을 검색합니다."
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="정렬 순서"
                    type="number"
                    value={catForm.sortOrder}
                    onChange={(v) => setCatForm({ ...catForm, sortOrder: v })}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <TextField
                label="표시 명칭 (한국어)"
                value={catForm.nameKo}
                onChange={(v) => setCatForm({ ...catForm, nameKo: v })}
                autoComplete="off"
              />
              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="표시 명칭 (독일어)"
                    value={catForm.nameDe}
                    onChange={(v) => setCatForm({ ...catForm, nameDe: v })}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="표시 명칭 (영어)"
                    value={catForm.nameEn}
                    onChange={(v) => setCatForm({ ...catForm, nameEn: v })}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <Select
                label="정규 벡터 아이콘 선택 (SVG)"
                options={ALLOWED_CATEGORY_ICONS.map((ic) => ({
                  label: ic,
                  value: ic,
                }))}
                value={catForm.iconName}
                onChange={(v) => setCatForm({ ...catForm, iconName: v })}
              />

              <TextField
                label="강조 뱃지 태그 (선택 - 예: HOT, NEW)"
                value={catForm.badgeTag}
                onChange={(v) => setCatForm({ ...catForm, badgeTag: v })}
                autoComplete="off"
              />

              <BlockStack gap="200">
                <Checkbox
                  label="상단 고정 Sticky GNB 탭에 노출"
                  checked={catForm.isGnbTab}
                  onChange={(v) => setCatForm({ ...catForm, isGnbTab: v })}
                />
                <Checkbox
                  label="메인 원형 카테고리 그리드에 노출"
                  checked={catForm.isCarousel}
                  onChange={(v) => setCatForm({ ...catForm, isCarousel: v })}
                />
                <Checkbox
                  label="활성화 (Active)"
                  checked={catForm.isActive}
                  onChange={(v) => setCatForm({ ...catForm, isActive: v })}
                />
              </BlockStack>

              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  2차 분류 (앱 상단 칩)
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  Shopify 컬렉션 핸들과 이름을 넣으면 이 카테고리 안에 하위
                  분류로 나옵니다. 2개 이상일 때만 칩이 보입니다.
                </Text>
                {(catForm.subcategories || []).map((sub, i) => {
                  const update = (patch) =>
                    setCatForm({
                      ...catForm,
                      subcategories: catForm.subcategories.map((row, j) =>
                        j === i ? { ...row, ...patch } : row,
                      ),
                    });
                  const move = (dir) => {
                    const next = [...catForm.subcategories];
                    const k = i + dir;
                    if (k < 0 || k >= next.length) return;
                    [next[i], next[k]] = [next[k], next[i]];
                    setCatForm({ ...catForm, subcategories: next });
                  };
                  return (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto",
                        gap: "6px",
                        alignItems: "end",
                      }}
                    >
                      <TextField
                        label="컬렉션 핸들"
                        labelHidden={i > 0}
                        value={sub.handle}
                        onChange={(v) => update({ handle: v.trim() })}
                        placeholder="냉동-식품"
                        autoComplete="off"
                      />
                      <TextField
                        label="이름 (한국어)"
                        labelHidden={i > 0}
                        value={sub.nameKo}
                        onChange={(v) => update({ nameKo: v })}
                        autoComplete="off"
                      />
                      <TextField
                        label="독일어"
                        labelHidden={i > 0}
                        value={sub.nameDe}
                        onChange={(v) => update({ nameDe: v })}
                        autoComplete="off"
                      />
                      <TextField
                        label="영어"
                        labelHidden={i > 0}
                        value={sub.nameEn}
                        onChange={(v) => update({ nameEn: v })}
                        autoComplete="off"
                      />
                      <InlineStack gap="100" wrap={false}>
                        <Button
                          size="slim"
                          onClick={() => move(-1)}
                          disabled={i === 0}
                          accessibilityLabel="위로"
                        >
                          ↑
                        </Button>
                        <Button
                          size="slim"
                          onClick={() => move(1)}
                          disabled={i === catForm.subcategories.length - 1}
                          accessibilityLabel="아래로"
                        >
                          ↓
                        </Button>
                        <Button
                          size="slim"
                          tone="critical"
                          onClick={() =>
                            setCatForm({
                              ...catForm,
                              subcategories: catForm.subcategories.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          삭제
                        </Button>
                      </InlineStack>
                    </div>
                  );
                })}
                <div>
                  <Button
                    size="slim"
                    onClick={() =>
                      setCatForm({
                        ...catForm,
                        subcategories: [
                          ...(catForm.subcategories || []),
                          { handle: "", nameKo: "", nameDe: "", nameEn: "" },
                        ],
                      })
                    }
                  >
                    2차 분류 추가
                  </Button>
                </div>
              </BlockStack>

              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Shopify 상품 유형으로 자동 구성
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  선택한 유형의 dawayo.de 판매 상품이 모두 이 카테고리에
                  들어갑니다. 새 상품도 유형만 맞으면 자동으로 들어갑니다.
                  아래에서 상품을 직접 지정하면 그 상품들만 표시됩니다.
                </Text>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "4px 12px",
                    maxHeight: "260px",
                    overflowY: "auto",
                    padding: "8px",
                    border: "1px solid #E3E3E3",
                    borderRadius: "8px",
                  }}
                >
                  {Object.entries(onlineProductTypes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <Checkbox
                        key={type}
                        label={`${type} (${count})`}
                        checked={(catForm.productTypes || []).includes(type)}
                        onChange={(checked) =>
                          setCatForm({
                            ...catForm,
                            productTypes: checked
                              ? [
                                  ...new Set([
                                    ...(catForm.productTypes || []),
                                    type,
                                  ]),
                                ]
                              : (catForm.productTypes || []).filter(
                                  (t) => t !== type,
                                ),
                          })
                        }
                      />
                    ))}
                  {Object.keys(onlineProductTypes).length === 0 && (
                    <Text tone="subdued" as="p">
                      {onlineProductTypesLoading
                        ? "상품 유형 목록을 불러오는 중…"
                        : "상품 유형 목록을 불러오지 못했습니다."}
                    </Text>
                  )}
                </div>
                {(catForm.productTypes || []).length > 0 && (
                  <Text variant="bodySm" as="p">
                    선택: {catForm.productTypes.join(", ")} · 약{" "}
                    {catForm.productTypes.reduce(
                      (n, t) => n + (onlineProductTypes[t] || 0),
                      0,
                    )}
                    개 상품
                  </Text>
                )}
              </BlockStack>

              <Divider />

              {/* Category Products Assignment Section */}
              <BlockStack gap="300">
                <div>
                  <Text variant="headingSm" as="h3">
                    카테고리 지정 상품 검색 및 추가 (
                    {catForm.assignedProducts?.length || 0}개)
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    이 카테고리에 노출할 상품을 직접 추가할 수 있습니다. (지정
                    상품이 없으면 자동 매칭)
                  </Text>
                </div>

                <InlineStack gap="200">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="쇼피파이 상품 검색"
                      labelHidden
                      placeholder="상품명 또는 SKU 입력 후 검색"
                      value={catProductSearchQuery}
                      onChange={setCatProductSearchQuery}
                      autoComplete="off"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && catProductSearchQuery.trim()) {
                          e.preventDefault();
                          const fd = new FormData();
                          fd.append("intent", "search_shopify_products");
                          fd.append("query", catProductSearchQuery);
                          catSearchFetcher.submit(fd, { method: "post" });
                        }
                      }}
                    />
                  </div>
                  <Button
                    loading={catSearchFetcher.state !== "idle"}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("intent", "search_shopify_products");
                      fd.append("query", catProductSearchQuery);
                      catSearchFetcher.submit(fd, { method: "post" });
                    }}
                  >
                    검색
                  </Button>
                </InlineStack>

                {/* Search Results */}
                {catSearchFetcher.data?.searchedProducts && (
                  <div
                    style={{
                      maxHeight: "220px",
                      overflowY: "auto",
                      border: "1px solid #E5E7EB",
                      borderRadius: "8px",
                      padding: "8px",
                      background: "#FAFAFA",
                    }}
                  >
                    {catSearchFetcher.data.searchedProducts.length === 0 ? (
                      <Text variant="bodySm" tone="subdued" as="p">
                        검색 결과가 없습니다.
                      </Text>
                    ) : (
                      <BlockStack gap="200">
                        {catSearchFetcher.data.searchedProducts.map((sp) => {
                          const isAdded = (catForm.assignedProducts || []).some(
                            (p) =>
                              String(p.productId || p.id) ===
                              String(sp.productId),
                          );
                          return (
                            <div
                              key={sp.productId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                background: "#FFFFFF",
                                border: "1px solid #E5E7EB",
                                borderRadius: "6px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  minWidth: 0,
                                }}
                              >
                                {sp.imageUrl && (
                                  <img
                                    src={sp.imageUrl}
                                    alt={sp.title}
                                    style={{
                                      width: "32px",
                                      height: "32px",
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
                                  <Text variant="bodyXs" tone="subdued" as="p">
                                    €{Number(sp.price || 0).toFixed(2)}
                                  </Text>
                                </div>
                              </div>
                              <Button
                                size="slim"
                                variant={isAdded ? "secondary" : "primary"}
                                disabled={isAdded}
                                onClick={() => {
                                  if (!isAdded) {
                                    setCatForm({
                                      ...catForm,
                                      assignedProducts: [
                                        ...(catForm.assignedProducts || []),
                                        {
                                          productId: sp.productId,
                                          variantId: sp.variantId,
                                          title: sp.title,
                                          imageUrl: sp.imageUrl,
                                          price: sp.price,
                                        },
                                      ],
                                    });
                                  }
                                }}
                              >
                                {isAdded ? "추가됨" : "+ 추가"}
                              </Button>
                            </div>
                          );
                        })}
                      </BlockStack>
                    )}
                  </div>
                )}

                {/* Assigned Products in this Category */}
                <div>
                  <Text variant="bodySm" fontWeight="bold" as="p">
                    지정된 상품 ({catForm.assignedProducts?.length || 0}개)
                  </Text>
                  {!catForm.assignedProducts ||
                  catForm.assignedProducts.length === 0 ? (
                    <div
                      style={{
                        padding: "16px",
                        textAlign: "center",
                        background: "#F9FAFB",
                        borderRadius: "8px",
                        border: "1px solid #E3E3E3",
                        marginTop: "6px",
                      }}
                    >
                      <Text variant="bodySm" tone="subdued" as="p">
                        지정된 상품이 없습니다. (카테고리 자동 매칭 적용 중)
                      </Text>
                    </div>
                  ) : (
                    <div
                      style={{
                        maxHeight: "240px",
                        overflowY: "auto",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "8px",
                        background: "#FFFFFF",
                        marginTop: "6px",
                      }}
                    >
                      <BlockStack gap="150">
                        {catForm.assignedProducts.map((p, pIdx) => (
                          <div
                            key={p.productId || p.id || pIdx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 10px",
                              background: "#F9FAFB",
                              borderRadius: "6px",
                              border: "1px solid #F3F4F6",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                minWidth: 0,
                              }}
                            >
                              {p.imageUrl && (
                                <img
                                  src={p.imageUrl}
                                  alt={p.title}
                                  style={{
                                    width: "30px",
                                    height: "30px",
                                    objectFit: "contain",
                                    borderRadius: "4px",
                                  }}
                                />
                              )}
                              <div style={{ minWidth: 0 }}>
                                <Text variant="bodySm" as="p" truncate>
                                  {p.title}
                                </Text>
                              </div>
                            </div>
                            <Button
                              size="slim"
                              tone="critical"
                              variant="plain"
                              onClick={() => {
                                setCatForm({
                                  ...catForm,
                                  assignedProducts:
                                    catForm.assignedProducts.filter(
                                      (item) =>
                                        (item.productId || item.id) !==
                                        (p.productId || p.id),
                                    ),
                                });
                              }}
                            >
                              제거
                            </Button>
                          </div>
                        ))}
                      </BlockStack>
                    </div>
                  )}
                </div>

                {/* Auto Filter Preview Section for Categories */}
                <div
                  style={{
                    marginTop: "12px",
                    padding: "14px",
                    background: "#F8FAFC",
                    borderRadius: "10px",
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <BlockStack gap="200">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Text variant="bodySm" fontWeight="bold" as="span">
                            키워드 규칙으로 찾은 상품
                          </Text>
                          <Badge tone="info">
                            키: {catForm.categoryKey || "전체"}
                          </Badge>
                        </div>
                        <Text variant="bodyXs" tone="subdued" as="p">
                          카테고리명으로 자동 매칭된 상품입니다.
                        </Text>
                      </div>
                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          loading={catAutoFilterFetcher.state !== "idle"}
                          onClick={() => triggerCatAutoFilter(catForm)}
                        >
                          자동 매칭 상품 조회
                        </Button>
                        {catAutoFilterFetcher.data?.autoFilteredProducts
                          ?.length > 0 && (
                          <Button
                            size="slim"
                            variant="primary"
                            onClick={() => {
                              const currentIds = new Set(
                                (catForm.assignedProducts || []).map((p) =>
                                  String(p.productId || p.id),
                                ),
                              );
                              const newOnes =
                                catAutoFilterFetcher.data.autoFilteredProducts.filter(
                                  (p) =>
                                    !currentIds.has(
                                      String(p.productId || p.id),
                                    ),
                                );
                              if (newOnes.length > 0) {
                                setCatForm({
                                  ...catForm,
                                  assignedProducts: [
                                    ...(catForm.assignedProducts || []),
                                    ...newOnes,
                                  ],
                                });
                              }
                            }}
                          >
                            + 전체 추가 (
                            {
                              catAutoFilterFetcher.data.autoFilteredProducts
                                .length
                            }
                            개)
                          </Button>
                        )}
                      </InlineStack>
                    </div>

                    {catAutoFilterFetcher.data?.autoFilteredProducts ? (
                      catAutoFilterFetcher.data.autoFilteredProducts.length ===
                      0 ? (
                        <div
                          style={{
                            padding: "12px",
                            background: "#FFFFFF",
                            borderRadius: "8px",
                            border: "1px solid #E3E3E3",
                            textAlign: "center",
                          }}
                        >
                          <Text variant="bodySm" tone="subdued" as="p">
                            &lsquo;{catForm.nameKo || catForm.categoryKey}
                            &rsquo; 조건과 일치하는 쇼피파이 활성 상품이
                            없습니다.
                          </Text>
                        </div>
                      ) : (
                        <div
                          style={{
                            maxHeight: "260px",
                            overflowY: "auto",
                            border: "1px solid #E2E8F0",
                            borderRadius: "8px",
                            background: "#FFFFFF",
                            padding: "6px",
                          }}
                        >
                          <BlockStack gap="150">
                            {catAutoFilterFetcher.data.autoFilteredProducts.map(
                              (sp) => {
                                const isAdded = (
                                  catForm.assignedProducts || []
                                ).some(
                                  (p) =>
                                    String(p.productId || p.id) ===
                                    String(sp.productId),
                                );
                                return (
                                  <div
                                    key={sp.productId}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "6px 10px",
                                      background: isAdded
                                        ? "#F0FDF4"
                                        : "#FFFFFF",
                                      border: isAdded
                                        ? "1px solid #BBF7D0"
                                        : "1px solid #F1F5F9",
                                      borderRadius: "6px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        minWidth: 0,
                                      }}
                                    >
                                      {sp.imageUrl && (
                                        <img
                                          src={sp.imageUrl}
                                          alt={sp.title}
                                          style={{
                                            width: "32px",
                                            height: "32px",
                                            objectFit: "contain",
                                            borderRadius: "4px",
                                          }}
                                        />
                                      )}
                                      <div style={{ minWidth: 0 }}>
                                        <Text
                                          variant="bodySm"
                                          fontWeight={
                                            isAdded ? "bold" : "regular"
                                          }
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
                                          €{Number(sp.price || 0).toFixed(2)}
                                        </Text>
                                      </div>
                                    </div>
                                    <div>
                                      {isAdded ? (
                                        <Badge tone="success">지정됨</Badge>
                                      ) : (
                                        <Button
                                          size="slim"
                                          onClick={() => {
                                            setCatForm({
                                              ...catForm,
                                              assignedProducts: [
                                                ...(catForm.assignedProducts ||
                                                  []),
                                                {
                                                  productId: sp.productId,
                                                  variantId: sp.variantId,
                                                  title: sp.title,
                                                  imageUrl: sp.imageUrl,
                                                  price: sp.price,
                                                },
                                              ],
                                            });
                                          }}
                                        >
                                          + 전용 추가
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </BlockStack>
                        </div>
                      )
                    ) : (
                      <div
                        style={{
                          padding: "12px",
                          background: "#FFFFFF",
                          borderRadius: "8px",
                          border: "1px solid #E3E3E3",
                          textAlign: "center",
                        }}
                      >
                        <Button
                          size="slim"
                          loading={catAutoFilterFetcher.state !== "idle"}
                          onClick={() => triggerCatAutoFilter(catForm)}
                        >
                          클릭하여 자동 필터(키워드) 매칭 상품 불러오기
                        </Button>
                      </div>
                    )}
                  </BlockStack>
                </div>
              </BlockStack>

              <Button
                variant="primary"
                loading={isSubmitting}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("intent", "save_category");
                  Object.entries(catForm).forEach(([k, val]) => {
                    if (k === "assignedProducts") {
                      fd.append("categoryProductsJson", JSON.stringify(val));
                    } else if (k === "productTypes") {
                      fd.append("productTypesJson", JSON.stringify(val));
                    } else if (k === "subcategories") {
                      fd.append("subcategoriesJson", JSON.stringify(val));
                    } else {
                      fd.append(k, String(val));
                    }
                  });
                  fetcher.submit(fd, { method: "post" });
                }}
              >
                카테고리 및 상품 설정 저장 및 앱 반영
              </Button>
            </BlockStack>
          </Card>
        </div>
      )}

      {/* Sub-tab 2: Brands */}
      {categorySubTab === "brands" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Left Card: Brand List */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  인기 브랜드 목록 ({config.brands?.length || 0}개)
                </Text>
                <Button size="slim" onClick={handleNewBrand}>
                  + 새 브랜드 추가
                </Button>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                {(config.brands || []).map((brand, idx) => {
                  const submit = (fields) => {
                    const fd = new FormData();
                    for (const [k, v] of Object.entries(fields))
                      fd.append(k, v);
                    fetcher.submit(fd, { method: "post" });
                  };
                  const assigned = brand.assignedProducts?.length || 0;
                  return (
                    <AdminListRow
                      key={brand.id}
                      noThumb
                      active={brand.isActive !== false}
                      selected={brandForm.brandId === brand.id}
                      badges={[
                        ...(brand.isActive === false
                          ? [{ label: "숨김" }]
                          : []),
                        ...(brand.tag && brand.tag !== brand.nameKo
                          ? [{ label: brand.tag, tone: "critical" }]
                          : []),
                      ]}
                      title={brand.nameKo}
                      subtitle={`검색어 "${brand.filter || brand.nameKo}" · ${assigned > 0 ? `지정 상품 ${assigned}개` : "상품명으로 자동 매칭"}`}
                      isFirst={idx === 0}
                      isLast={idx === (config.brands || []).length - 1}
                      onMove={(direction) =>
                        submit({
                          intent: "reorder_brand",
                          brandId: brand.id,
                          direction,
                        })
                      }
                      actions={[
                        {
                          label: "수정",
                          onClick: () => handleEditBrand(brand),
                        },
                        {
                          label: "삭제",
                          tone: "critical",
                          confirm: `'${brand.nameKo}' 브랜드를 삭제할까요?`,
                          onClick: () =>
                            submit({
                              intent: "delete_brand",
                              brandId: brand.id,
                            }),
                        },
                      ]}
                    />
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Right Card: Brand Edit & Product Picker */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  {brandForm.brandId ? "브랜드 상세 수정" : "새 브랜드 추가"}
                </Text>
                {brandForm.brandId && (
                  <Button size="slim" onClick={handleNewBrand}>
                    새 브랜드 등록으로 전환
                  </Button>
                )}
              </InlineStack>
              <Divider />
              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="브랜드 식별키 (영문)"
                    value={brandForm.brandKey}
                    onChange={(v) =>
                      setBrandForm({ ...brandForm, brandKey: v })
                    }
                    placeholder="예: nongshim, cj, samyang"
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="정렬 순서"
                    type="number"
                    value={brandForm.sortOrder}
                    onChange={(v) =>
                      setBrandForm({ ...brandForm, sortOrder: v })
                    }
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <TextField
                label="브랜드 명칭 (한국어)"
                value={brandForm.nameKo}
                onChange={(v) => setBrandForm({ ...brandForm, nameKo: v })}
                autoComplete="off"
              />
              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="브랜드 명칭 (독일어)"
                    value={brandForm.nameDe}
                    onChange={(v) => setBrandForm({ ...brandForm, nameDe: v })}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="브랜드 명칭 (영어)"
                    value={brandForm.nameEn}
                    onChange={(v) => setBrandForm({ ...brandForm, nameEn: v })}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="배지 태그 (예: 신라면·짜파게티)"
                    value={brandForm.tag}
                    onChange={(v) => setBrandForm({ ...brandForm, tag: v })}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="상품 검색어 (상품명에 들어간 단어)"
                    value={brandForm.filter}
                    onChange={(v) => setBrandForm({ ...brandForm, filter: v })}
                    placeholder="예: 농심, CJ, 삼양"
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <TextField
                label="브랜드 소개 (한국어 한 줄)"
                value={brandForm.descKo}
                onChange={(v) => setBrandForm({ ...brandForm, descKo: v })}
                placeholder="예: 대한민국 대표 라면 & 스낵"
                autoComplete="off"
              />

              <Checkbox
                label="활성화 (앱에 노출)"
                checked={brandForm.isActive}
                onChange={(v) => setBrandForm({ ...brandForm, isActive: v })}
              />

              <Divider />

              {/* Brand Products Assignment Section */}
              <BlockStack gap="300">
                <div>
                  <Text variant="headingSm" as="h3">
                    브랜드 전용 상품 검색 및 추가 (
                    {brandForm.assignedProducts?.length || 0}개)
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    이 브랜드에 노출할 상품을 직접 추가할 수 있습니다. (지정
                    상품이 없으면 벤더명 자동 필터)
                  </Text>
                </div>

                <InlineStack gap="200">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="쇼피파이 상품 검색"
                      labelHidden
                      placeholder="상품명 또는 SKU 입력 후 검색"
                      value={brandProductSearchQuery}
                      onChange={setBrandProductSearchQuery}
                      autoComplete="off"
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          brandProductSearchQuery.trim()
                        ) {
                          e.preventDefault();
                          const fd = new FormData();
                          fd.append("intent", "search_shopify_products");
                          fd.append("query", brandProductSearchQuery);
                          brandSearchFetcher.submit(fd, { method: "post" });
                        }
                      }}
                    />
                  </div>
                  <Button
                    loading={brandSearchFetcher.state !== "idle"}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("intent", "search_shopify_products");
                      fd.append("query", brandProductSearchQuery);
                      brandSearchFetcher.submit(fd, { method: "post" });
                    }}
                  >
                    검색
                  </Button>
                </InlineStack>

                {/* Brand Search Results */}
                {brandSearchFetcher.data?.searchedProducts && (
                  <div
                    style={{
                      maxHeight: "220px",
                      overflowY: "auto",
                      border: "1px solid #E5E7EB",
                      borderRadius: "8px",
                      padding: "8px",
                      background: "#FAFAFA",
                    }}
                  >
                    {brandSearchFetcher.data.searchedProducts.length === 0 ? (
                      <Text variant="bodySm" tone="subdued" as="p">
                        검색 결과가 없습니다.
                      </Text>
                    ) : (
                      <BlockStack gap="200">
                        {brandSearchFetcher.data.searchedProducts.map((sp) => {
                          const isAdded = (
                            brandForm.assignedProducts || []
                          ).some(
                            (p) =>
                              String(p.productId || p.id) ===
                              String(sp.productId),
                          );
                          return (
                            <div
                              key={sp.productId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                background: "#FFFFFF",
                                border: "1px solid #E5E7EB",
                                borderRadius: "6px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  minWidth: 0,
                                }}
                              >
                                {sp.imageUrl && (
                                  <img
                                    src={sp.imageUrl}
                                    alt={sp.title}
                                    style={{
                                      width: "32px",
                                      height: "32px",
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
                                  <Text variant="bodyXs" tone="subdued" as="p">
                                    €{Number(sp.price || 0).toFixed(2)}
                                  </Text>
                                </div>
                              </div>
                              <Button
                                size="slim"
                                variant={isAdded ? "secondary" : "primary"}
                                disabled={isAdded}
                                onClick={() => {
                                  if (!isAdded) {
                                    setBrandForm({
                                      ...brandForm,
                                      assignedProducts: [
                                        ...(brandForm.assignedProducts || []),
                                        {
                                          productId: sp.productId,
                                          variantId: sp.variantId,
                                          title: sp.title,
                                          imageUrl: sp.imageUrl,
                                          price: sp.price,
                                        },
                                      ],
                                    });
                                  }
                                }}
                              >
                                {isAdded ? "추가됨" : "+ 추가"}
                              </Button>
                            </div>
                          );
                        })}
                      </BlockStack>
                    )}
                  </div>
                )}

                {/* Brand Assigned Products List */}
                <div>
                  <Text variant="bodySm" fontWeight="bold" as="p">
                    지정된 브랜드 상품 (
                    {brandForm.assignedProducts?.length || 0}개)
                  </Text>
                  {!brandForm.assignedProducts ||
                  brandForm.assignedProducts.length === 0 ? (
                    <div
                      style={{
                        padding: "16px",
                        textAlign: "center",
                        background: "#F9FAFB",
                        borderRadius: "8px",
                        border: "1px solid #E3E3E3",
                        marginTop: "6px",
                      }}
                    >
                      <Text variant="bodySm" tone="subdued" as="p">
                        지정된 상품이 없습니다. (벤더명 자동 필터 적용 중)
                      </Text>
                    </div>
                  ) : (
                    <div
                      style={{
                        maxHeight: "240px",
                        overflowY: "auto",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "8px",
                        background: "#FFFFFF",
                        marginTop: "6px",
                      }}
                    >
                      <BlockStack gap="150">
                        {brandForm.assignedProducts.map((p, pIdx) => (
                          <div
                            key={p.productId || p.id || pIdx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 10px",
                              background: "#F9FAFB",
                              borderRadius: "6px",
                              border: "1px solid #F3F4F6",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                minWidth: 0,
                              }}
                            >
                              {p.imageUrl && (
                                <img
                                  src={p.imageUrl}
                                  alt={p.title}
                                  style={{
                                    width: "30px",
                                    height: "30px",
                                    objectFit: "contain",
                                    borderRadius: "4px",
                                  }}
                                />
                              )}
                              <div style={{ minWidth: 0 }}>
                                <Text variant="bodySm" as="p" truncate>
                                  {p.title}
                                </Text>
                              </div>
                            </div>
                            <Button
                              size="slim"
                              tone="critical"
                              variant="plain"
                              onClick={() => {
                                setBrandForm({
                                  ...brandForm,
                                  assignedProducts:
                                    brandForm.assignedProducts.filter(
                                      (item) =>
                                        (item.productId || item.id) !==
                                        (p.productId || p.id),
                                    ),
                                });
                              }}
                            >
                              제거
                            </Button>
                          </div>
                        ))}
                      </BlockStack>
                    </div>
                  )}
                </div>

                {/* Auto Filter Preview Section for Brands */}
                <div
                  style={{
                    marginTop: "12px",
                    padding: "14px",
                    background: "#F8FAFC",
                    borderRadius: "10px",
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <BlockStack gap="200">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Text variant="bodySm" fontWeight="bold" as="span">
                            브랜드명으로 찾은 상품
                          </Text>
                          <Badge tone="info">
                            벤더:{" "}
                            {brandForm.filter || brandForm.nameKo || "미지정"}
                          </Badge>
                        </div>
                        <Text variant="bodyXs" tone="subdued" as="p">
                          지정 전용 상품이 없을 때 앱에서 자동 조회되는 현재
                          쇼피파이 활성 상품 목록입니다.
                        </Text>
                      </div>
                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          loading={brandAutoFilterFetcher.state !== "idle"}
                          onClick={() => triggerBrandAutoFilter(brandForm)}
                        >
                          자동 필터 상품 조회
                        </Button>
                        {brandAutoFilterFetcher.data?.autoFilteredProducts
                          ?.length > 0 && (
                          <Button
                            size="slim"
                            variant="primary"
                            onClick={() => {
                              const currentIds = new Set(
                                (brandForm.assignedProducts || []).map((p) =>
                                  String(p.productId || p.id),
                                ),
                              );
                              const newOnes =
                                brandAutoFilterFetcher.data.autoFilteredProducts.filter(
                                  (p) =>
                                    !currentIds.has(
                                      String(p.productId || p.id),
                                    ),
                                );
                              if (newOnes.length > 0) {
                                setBrandForm({
                                  ...brandForm,
                                  assignedProducts: [
                                    ...(brandForm.assignedProducts || []),
                                    ...newOnes,
                                  ],
                                });
                              }
                            }}
                          >
                            + 전체 추가 (
                            {
                              brandAutoFilterFetcher.data.autoFilteredProducts
                                .length
                            }
                            개)
                          </Button>
                        )}
                      </InlineStack>
                    </div>

                    {brandAutoFilterFetcher.data?.autoFilteredProducts ? (
                      brandAutoFilterFetcher.data.autoFilteredProducts
                        .length === 0 ? (
                        <div
                          style={{
                            padding: "12px",
                            background: "#FFFFFF",
                            borderRadius: "8px",
                            border: "1px solid #E3E3E3",
                            textAlign: "center",
                          }}
                        >
                          <Text variant="bodySm" tone="subdued" as="p">
                            &lsquo;{brandForm.filter || brandForm.nameKo}&rsquo;
                            조건과 일치하는 쇼피파이 활성 상품을 찾지
                            못했습니다. 벤더명을 확인해주세요.
                          </Text>
                        </div>
                      ) : (
                        <div
                          style={{
                            maxHeight: "260px",
                            overflowY: "auto",
                            border: "1px solid #E2E8F0",
                            borderRadius: "8px",
                            background: "#FFFFFF",
                            padding: "6px",
                          }}
                        >
                          <BlockStack gap="150">
                            {brandAutoFilterFetcher.data.autoFilteredProducts.map(
                              (sp) => {
                                const isAdded = (
                                  brandForm.assignedProducts || []
                                ).some(
                                  (p) =>
                                    String(p.productId || p.id) ===
                                    String(sp.productId),
                                );
                                return (
                                  <div
                                    key={sp.productId}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "6px 10px",
                                      background: isAdded
                                        ? "#F0FDF4"
                                        : "#FFFFFF",
                                      border: isAdded
                                        ? "1px solid #BBF7D0"
                                        : "1px solid #F1F5F9",
                                      borderRadius: "6px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        minWidth: 0,
                                      }}
                                    >
                                      {sp.imageUrl && (
                                        <img
                                          src={sp.imageUrl}
                                          alt={sp.title}
                                          style={{
                                            width: "32px",
                                            height: "32px",
                                            objectFit: "contain",
                                            borderRadius: "4px",
                                          }}
                                        />
                                      )}
                                      <div style={{ minWidth: 0 }}>
                                        <Text
                                          variant="bodySm"
                                          fontWeight={
                                            isAdded ? "bold" : "regular"
                                          }
                                          as="p"
                                          truncate
                                        >
                                          {sp.title}
                                        </Text>
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: "8px",
                                            alignItems: "center",
                                          }}
                                        >
                                          <Text
                                            variant="bodyXs"
                                            tone="subdued"
                                            as="span"
                                          >
                                            €{Number(sp.price || 0).toFixed(2)}
                                          </Text>
                                          {sp.vendor && (
                                            <Text
                                              variant="bodyXs"
                                              tone="subdued"
                                              as="span"
                                            >
                                              · 벤더: {sp.vendor}
                                            </Text>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div>
                                      {isAdded ? (
                                        <Badge tone="success">
                                          전용 상품에 추가됨
                                        </Badge>
                                      ) : (
                                        <Button
                                          size="slim"
                                          onClick={() => {
                                            setBrandForm({
                                              ...brandForm,
                                              assignedProducts: [
                                                ...(brandForm.assignedProducts ||
                                                  []),
                                                {
                                                  productId: sp.productId,
                                                  variantId: sp.variantId,
                                                  title: sp.title,
                                                  imageUrl: sp.imageUrl,
                                                  price: sp.price,
                                                },
                                              ],
                                            });
                                          }}
                                        >
                                          + 전용 상품으로 추가
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </BlockStack>
                        </div>
                      )
                    ) : (
                      <div
                        style={{
                          padding: "12px",
                          background: "#FFFFFF",
                          borderRadius: "8px",
                          border: "1px solid #E3E3E3",
                          textAlign: "center",
                        }}
                      >
                        <Button
                          size="slim"
                          loading={brandAutoFilterFetcher.state !== "idle"}
                          onClick={() => triggerBrandAutoFilter(brandForm)}
                        >
                          클릭하여 자동 필터(
                          {brandForm.filter || brandForm.nameKo || "벤더"}) 적용
                          상품 불러오기
                        </Button>
                      </div>
                    )}
                  </BlockStack>
                </div>
              </BlockStack>

              <Button
                variant="primary"
                loading={isSubmitting}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("intent", "save_brand");
                  Object.entries(brandForm).forEach(([k, val]) => {
                    if (k === "assignedProducts") {
                      fd.append("brandProductsJson", JSON.stringify(val));
                    } else {
                      fd.append(k, String(val));
                    }
                  });
                  fetcher.submit(fd, { method: "post" });
                }}
              >
                브랜드 설정 저장 및 앱 반영
              </Button>
            </BlockStack>
          </Card>
        </div>
      )}
    </BlockStack>
  );
}
