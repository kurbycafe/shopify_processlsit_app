import { useState } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Tabs,
  TextField,
  Box,
  Card,
  InlineGrid,
  Divider,
} from "@shopify/polaris";
import { RECIPE_PRESETS, RECIPE_CATEGORIES, RECIPE_OCCASIONS } from "../../utils/recipePresets";

export default function RecipePresetModal({ open, onClose, onSelectPreset }) {
  const [selectedCategoryTab, setSelectedCategoryTab] = useState(0);
  const [selectedOccasion, setSelectedOccasion] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const activeCategory = RECIPE_CATEGORIES[selectedCategoryTab]?.id || "ALL";

  const filteredPresets = RECIPE_PRESETS.filter((preset) => {
    // Category match
    if (activeCategory !== "ALL" && preset.category !== activeCategory) {
      return false;
    }
    // Occasion match
    if (selectedOccasion !== "ALL" && preset.occasion !== selectedOccasion) {
      return false;
    }
    // Search query match
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const koTitle = preset.translations.ko?.title?.toLowerCase() || "";
      const deTitle = preset.translations.de?.title?.toLowerCase() || "";
      const enTitle = preset.translations.en?.title?.toLowerCase() || "";
      const ingMatch = preset.defaultIngredients.some(
        (i) => i.nameKo.toLowerCase().includes(q) || i.nameDe.toLowerCase().includes(q) || i.nameEn.toLowerCase().includes(q)
      );
      return koTitle.includes(q) || deTitle.includes(q) || enTitle.includes(q) || ingMatch;
    }
    return true;
  });

  const categoryTabs = RECIPE_CATEGORIES.map((cat) => ({
    id: cat.id,
    content: cat.labelKo,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="K-Food 레시피 프리셋 라이브러리 (Commerce Template Library)"
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued" variant="bodyMd">
            독일/유럽 소비자가 선호하는 K-Food 대표 레시피 템플릿을 선택하세요. 
            한국어/독일어/영어 3개 국어 설명과 필수 식재료 키워드가 자동으로 완성됩니다.
          </Text>

          {/* Search and Occasion filter */}
          <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="300">
            <TextField
              label="레시피 / 식재료 키워드 검색"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="예: 떡볶이, 고추장, 불고기, Kimchi..."
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
            />

            <div>
              <Text as="span" variant="bodySm" tone="subdued">목적 / 상황별 필터</Text>
              <div style={{ marginTop: "4px" }}>
                <select
                  value={selectedOccasion}
                  onChange={(e) => setSelectedOccasion(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    borderRadius: "6px",
                    border: "1px solid #c9cccf",
                    padding: "0 8px",
                    background: "#ffffff",
                    fontSize: "14px"
                  }}
                >
                  {RECIPE_OCCASIONS.map((occ) => (
                    <option key={occ.id} value={occ.id}>
                      {occ.labelKo}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </InlineGrid>

          {/* Category Tabs */}
          <Tabs tabs={categoryTabs} selected={selectedCategoryTab} onSelect={setSelectedCategoryTab} />

          <Divider />

          {/* Preset Cards Grid */}
          {filteredPresets.length === 0 ? (
            <Box padding="600" textAlign="center">
              <Text as="p" tone="subdued">일치하는 프리셋이 없습니다. 다른 카테고리나 검색어를 선택해 보세요.</Text>
            </Box>
          ) : (
            <div style={{ maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
              <BlockStack gap="300">
                {filteredPresets.map((preset) => {
                  const ko = preset.translations.ko;
                  const de = preset.translations.de;
                  return (
                    <Card key={preset.id} padding="300">
                      <InlineStack align="space-between" blockAlign="center" gap="400">
                        <InlineStack gap="300" blockAlign="start" style={{ flex: 1 }}>
                          {preset.imageUrl ? (
                            <img
                              src={preset.imageUrl}
                              alt={ko.title}
                              style={{ width: "90px", height: "90px", objectFit: "cover", borderRadius: "8px", flexShrink: 0 }}
                            />
                          ) : (
                            <Box width="90px" height="90px" background="bg-surface-secondary" borderRadius="200" />
                          )}

                          <BlockStack gap="100" style={{ flex: 1 }}>
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingSm" fontWeight="bold">
                                {ko.title}
                              </Text>
                              <Badge tone="info">{preset.category}</Badge>
                              <Badge tone="success">난이도: {preset.difficulty}</Badge>
                            </InlineStack>

                            <Text as="p" variant="bodyXs" tone="subdued">
                              독일어: {de.title}
                            </Text>

                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyXs" tone="subdued">
                                조리: {preset.prepTimeMinutes + preset.cookTimeMinutes}분 | {preset.baseServings}인분 기준 | 매운맛 {preset.spiceLevel}단계
                              </Text>
                              <Text as="span" variant="bodyXs" tone="subdued">
                                식재료: {preset.defaultIngredients.length}종 내장
                              </Text>
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>

                        <Button
                          variant="primary"
                          onClick={() => {
                            onSelectPreset(preset);
                            onClose();
                          }}
                        >
                          이 프리셋 적용하기
                        </Button>
                      </InlineStack>
                    </Card>
                  );
                })}
              </BlockStack>
            </div>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
