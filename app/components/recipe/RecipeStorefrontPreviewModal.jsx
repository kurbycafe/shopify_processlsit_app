import { useState } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Box,
} from "@shopify/polaris";
import { buildAdvancedArticleHtml } from "../../utils/recipeHtmlBuilder";

export default function RecipeStorefrontPreviewModal({ open, onClose, recipe }) {
  const [deviceMode, setDeviceMode] = useState("desktop"); // desktop or mobile
  const [previewLocale, setPreviewLocale] = useState("de"); // de, en, ko

  if (!recipe) return null;

  const htmlContent = buildAdvancedArticleHtml(recipe, {
    activeLocale: previewLocale,
    currencySymbol: "€",
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="스토어프론트 실시간 라이브 프리뷰 (Live Storefront Preview)"
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodySm" fontWeight="bold">미리보기 언어:</Text>
              <ButtonGroup segmented>
                <Button
                  pressed={previewLocale === "de"}
                  onClick={() => setPreviewLocale("de")}
                  size="slim"
                >
                  독일어 (DE)
                </Button>
                <Button
                  pressed={previewLocale === "en"}
                  onClick={() => setPreviewLocale("en")}
                  size="slim"
                >
                  영어 (EN)
                </Button>
                <Button
                  pressed={previewLocale === "ko"}
                  onClick={() => setPreviewLocale("ko")}
                  size="slim"
                >
                  한국어 (KO)
                </Button>
              </ButtonGroup>
            </InlineStack>

            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodySm" fontWeight="bold">화면 모드:</Text>
              <ButtonGroup segmented>
                <Button
                  pressed={deviceMode === "desktop"}
                  onClick={() => setDeviceMode("desktop")}
                  size="slim"
                >
                  데스크톱 (PC)
                </Button>
                <Button
                  pressed={deviceMode === "mobile"}
                  onClick={() => setDeviceMode("mobile")}
                  size="slim"
                >
                  모바일 (Mobile)
                </Button>
              </ButtonGroup>
            </InlineStack>
          </InlineStack>

          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="300"
            style={{
              display: "flex",
              justifyContent: "center",
              minHeight: "520px",
              maxHeight: "680px",
              overflowY: "auto",
              border: "1px solid #e1e3e5",
            }}
          >
            <div
              style={{
                width: deviceMode === "mobile" ? "375px" : "100%",
                maxWidth: deviceMode === "mobile" ? "375px" : "780px",
                background: "#ffffff",
                borderRadius: deviceMode === "mobile" ? "24px" : "12px",
                boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                padding: deviceMode === "mobile" ? "12px" : "0",
                transition: "all 0.3s ease",
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
            </div>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
