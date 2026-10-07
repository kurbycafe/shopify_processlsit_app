import { Box, BlockStack, Text, Button } from "@shopify/polaris";

export default function AppEmptyState({
  title = "데이터가 없습니다",
  description = "조건에 부합하는 항목이 없거나 아직 등록된 내역이 없습니다.",
  actionText,
  onAction,
  secondaryActionText,
  onSecondaryAction,
  icon,
}) {
  return (
    <Box padding="800">
      <div style={{ textAlign: "center", maxWidth: "480px", margin: "0 auto" }}>
        <BlockStack gap="400" align="center">
          {icon && <div style={{ marginBottom: "8px" }}>{icon}</div>}
          <Text variant="headingMd" as="h3" fontWeight="bold">
            {title}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {description}
          </Text>

          {(actionText || secondaryActionText) && (
            <div style={{ marginTop: "12px", display: "flex", gap: "8px", justifyContent: "center" }}>
              {actionText && (
                <Button variant="primary" onClick={onAction}>
                  {actionText}
                </Button>
              )}
              {secondaryActionText && (
                <Button onClick={onSecondaryAction}>
                  {secondaryActionText}
                </Button>
              )}
            </div>
          )}
        </BlockStack>
      </div>
    </Box>
  );
}
