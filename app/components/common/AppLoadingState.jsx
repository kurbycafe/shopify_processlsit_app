import { Box, BlockStack, Spinner, Text } from "@shopify/polaris";

/**
 * Standardized Loading State Component
 */
export default function AppLoadingState({ message = "데이터를 불러오는 중입니다..." }) {
  return (
    <Box padding="800">
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "220px" }}>
        <BlockStack gap="400" align="center">
          <Spinner accessibilityLabel="Loading" size="large" />
          <Text variant="bodyMd" tone="subdued">
            {message}
          </Text>
        </BlockStack>
      </div>
    </Box>
  );
}
