import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import {
  RECIPE_CATEGORIES,
  RECIPE_OCCASIONS,
  SPICE_LEVELS,
  DIETARY_OPTIONS,
} from "../../utils/recipePresets";

export default function RecipeMetadataSettings({
  category,
  onChangeCategory,
  occasion,
  onChangeOccasion,
  difficulty,
  onChangeDifficulty,
  prepTimeMinutes,
  onChangePrepTime,
  cookTimeMinutes,
  onChangeCookTime,
  servings,
  onChangeServings,
  spiceLevel,
  onChangeSpiceLevel,
  dietaryFlags,
  onChangeDietaryFlags,
  imageUrl,
  onChangeImageUrl,
}) {
  const categoryOptions = RECIPE_CATEGORIES.filter((c) => c.id !== "ALL").map((c) => ({
    label: c.labelKo,
    value: c.id,
  }));

  const occasionOptions = RECIPE_OCCASIONS.filter((o) => o.id !== "ALL").map((o) => ({
    label: o.labelKo,
    value: o.id,
  }));

  const difficultyOptions = [
    { label: "쉬움 (Easy - 15분 이내)", value: "EASY" },
    { label: "보통 (Medium - 일반 조리)", value: "MEDIUM" },
    { label: "어려움 (Hard - 정통/손 많이 감)", value: "HARD" },
  ];

  const spiceOptions = SPICE_LEVELS.map((s) => ({
    label: s.labelKo,
    value: String(s.level),
  }));

  const handleToggleDietary = (flagId) => {
    const current = dietaryFlags || [];
    if (current.includes(flagId)) {
      onChangeDietaryFlags(current.filter((f) => f !== flagId));
    } else {
      onChangeDietaryFlags([...current, flagId]);
    }
  };

  return (
    <Card padding="400">
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">레시피 메타데이터 & 특성 설정 (Recipe Attributes)</Text>

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <Select
            label="음식 카테고리 (Category)"
            options={categoryOptions}
            value={category}
            onChange={onChangeCategory}
          />

          <Select
            label="목적 / 상황별 템플릿 (Occasion)"
            options={occasionOptions}
            value={occasion || "QUICK_MEAL"}
            onChange={onChangeOccasion}
          />
        </InlineGrid>

        <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
          <Select
            label="난이도 (Difficulty)"
            options={difficultyOptions}
            value={difficulty}
            onChange={onChangeDifficulty}
          />

          <TextField
            label="준비 시간 (분)"
            type="number"
            value={String(prepTimeMinutes || 10)}
            onChange={(val) => onChangePrepTime(parseInt(val) || 10)}
            autoComplete="off"
          />

          <TextField
            label="조리 시간 (분)"
            type="number"
            value={String(cookTimeMinutes || 15)}
            onChange={(val) => onChangeCookTime(parseInt(val) || 15)}
            autoComplete="off"
          />

          <TextField
            label="기본 분량 (인분)"
            type="number"
            value={String(servings || 2)}
            onChange={(val) => onChangeServings(parseInt(val) || 2)}
            autoComplete="off"
          />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <Select
            label="매운맛 단계 (Spice Level)"
            options={spiceOptions}
            value={String(spiceLevel ?? 2)}
            onChange={(val) => onChangeSpiceLevel(parseInt(val) || 0)}
          />

          <TextField
            label="대표 이미지 URL (Unsplash / CDN)"
            value={imageUrl || ""}
            onChange={onChangeImageUrl}
            placeholder="https://images.unsplash.com/photo-..."
            autoComplete="off"
          />
        </InlineGrid>

        {imageUrl && (
          <Box maxWidth="180px" padding="100" style={{ border: "1px solid #e1e3e5", borderRadius: "8px" }}>
            <img src={imageUrl} alt="미리보기" style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "6px" }} />
          </Box>
        )}

        <BlockStack gap="200">
          <Text as="h4" variant="headingXs">식이요법 & 알레르기 배지 (Dietary Flags)</Text>
          <InlineStack gap="200" wrap>
            {DIETARY_OPTIONS.map((opt) => {
              const isSelected = (dietaryFlags || []).includes(opt.id);
              return (
                <div
                  key={opt.id}
                  onClick={() => handleToggleDietary(opt.id)}
                  style={{
                    cursor: "pointer",
                    padding: "4px 10px",
                    borderRadius: "16px",
                    border: isSelected ? "2px solid #008060" : "1px solid #c9cccf",
                    background: isSelected ? "#f0fdf4" : "#ffffff",
                    color: isSelected ? "#166534" : "#4a5568",
                    fontSize: "13px",
                    fontWeight: isSelected ? 700 : 500,
                  }}
                >
                  {isSelected ? `✓ ${opt.label}` : `+ ${opt.label}`}
                </div>
              );
            })}
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
