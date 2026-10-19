import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Tabs,
  TextField,
  Text,
  Badge,
  Banner,
} from "@shopify/polaris";

export default function RecipeLocalizationEditor({ translations = {}, onChangeTranslations }) {
  const [selectedTab, setSelectedTab] = useState(1); // Default to German (DE) for DAWAYO

  const tabs = [
    { id: "ko", content: "한국어 (KO)", badge: "원문" },
    { id: "de", content: "독일어 (DE)", badge: "상점 기본" },
    { id: "en", content: "영어 (EN)", badge: "글로벌" },
  ];

  const currentLang = tabs[selectedTab]?.id || "de";
  const currentData = (translations && translations[currentLang]) || {
    title: "",
    subtitle: "",
    introduction: "",
    steps: "",
  };

  const handleChangeField = (field, value) => {
    onChangeTranslations({
      ...translations,
      [currentLang]: {
        ...currentData,
        [field]: value,
      },
    });
  };

  const stepsString = Array.isArray(currentData.steps)
    ? currentData.steps.join("\n")
    : (currentData.steps || "");

  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <div>
            <Text as="h2" variant="headingMd">다국어 콘텐츠 에디터 (Localization)</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              독일/유럽 소비자를 위한 독일어 및 영어 레시피 본문을 언어별로 작성합니다.
            </Text>
          </div>
          <Badge tone="info">유럽/독일 커머스 최적화</Badge>
        </InlineStack>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

        {currentLang === "de" && (
          <Banner tone="info">
            독일어 레시피는 독일 소비자가 이해하기 쉬운 식재료 설명(예: Reiskuchen, Chilipaste)과 조리법이 권장됩니다.
          </Banner>
        )}

        <BlockStack gap="300">
          <TextField
            label={`레시피 제목 (${currentLang.toUpperCase()})`}
            value={currentData.title || ""}
            onChange={(val) => handleChangeField("title", val)}
            placeholder={
              currentLang === "de"
                ? "예: Koreanische Reiskuchen in scharfer Sauce (Tteokbokki)"
                : currentLang === "en"
                ? "예: Korean Spicy & Sweet Rice Cakes (Tteokbokki)"
                : "예: 매콤달콤 쫄깃한 한국 대표 길거리 간식, 떡볶이"
            }
            autoComplete="off"
          />

          <TextField
            label={`부제목 / 슬로건 (${currentLang.toUpperCase()})`}
            value={currentData.subtitle || ""}
            onChange={(val) => handleChangeField("subtitle", val)}
            placeholder={
              currentLang === "de"
                ? "예: Koreas beliebtestes Streetfood - einfach in 15 Minuten"
                : "예: 15분 만에 완성하는 국민 분식 황금 레시피"
            }
            autoComplete="off"
          />

          <TextField
            label={`음식 소개 및 역사 (${currentLang.toUpperCase()})`}
            value={currentData.introduction || ""}
            onChange={(val) => handleChangeField("introduction", val)}
            placeholder="이 요리의 특징, 맛의 포인트, 어울리는 반찬 등을 매력적으로 소개해 보세요."
            multiline={4}
            autoComplete="off"
          />

          <TextField
            label={`조리 순서 (Steps - 1줄에 1단계씩 입력하세요)`}
            value={stepsString}
            onChange={(val) => handleChangeField("steps", val)}
            placeholder={
              currentLang === "de"
                ? "1. Reiskuchen 10 Minuten einweichen.\n2. Sauce anrühren und aufkochen.\n3. Reiskuchen und Fischkuchen 5 Minuten köcheln lassen."
                : "1. 떡을 물에 10분간 불립니다.\n2. 양념장을 끓입니다.\n3. 떡과 어묵을 넣고 졸입니다."
            }
            multiline={6}
            autoComplete="off"
          />
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
