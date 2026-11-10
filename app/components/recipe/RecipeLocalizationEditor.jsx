import { useState } from "react";
import {
  Card,
  BlockStack,
  Tabs,
  TextField,
  Text,
} from "@shopify/polaris";

export default function RecipeLocalizationEditor({ translations = {}, onChangeTranslations }) {
  const [selectedTab, setSelectedTab] = useState(1); // Default to German (DE) for DAWAYO

  const tabs = [
    { id: "ko", content: "한국어" },
    { id: "de", content: "독일어" },
    { id: "en", content: "영어" },
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
        <div>
          <Text as="h2" variant="headingMd">언어별 본문 작성</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            언어별 제목, 소개, 조리 순서를 입력합니다.
          </Text>
        </div>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

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
            label={`부제목 (${currentLang.toUpperCase()})`}
            value={currentData.subtitle || ""}
            onChange={(val) => handleChangeField("subtitle", val)}
            placeholder={
              currentLang === "de"
                ? "예: Koreas beliebtestes Streetfood - einfach in 15 Minuten"
                : "예: 15분 만에 완성하는 국민 분식 레시피"
            }
            autoComplete="off"
          />

          <TextField
            label={`음식 소개 (${currentLang.toUpperCase()})`}
            value={currentData.introduction || ""}
            onChange={(val) => handleChangeField("introduction", val)}
            placeholder="요리의 특징과 어울리는 구성을 소개하세요."
            multiline={4}
            autoComplete="off"
          />

          <TextField
            label="조리 순서 (한 줄에 한 단계씩 입력)"
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
