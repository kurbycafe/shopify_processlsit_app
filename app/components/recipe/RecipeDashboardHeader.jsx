import { Card, InlineGrid, BlockStack, Text, Box } from "@shopify/polaris";

export default function RecipeDashboardHeader({ recipes = [] }) {
  const totalCount = recipes.length;
  const publishedCount = recipes.filter((r) => r.published).length;
  const draftCount = totalCount - publishedCount;
  
  const attentionCount = recipes.filter((r) => {
    const prods = r.products || [];
    if (prods.length === 0) return true;
    return prods.some((p) => p.isAvailable === false);
  }).length;

  return (
    <Card padding="400">
      <InlineGrid columns={{ xs: 2, sm: 4 }} gap="400">
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">전체 레시피</Text>
            <Text as="p" variant="headingLg" fontWeight="bold">{totalCount}</Text>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">게시됨</Text>
            <Text as="p" variant="headingLg" fontWeight="bold">{publishedCount}</Text>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">임시 저장</Text>
            <Text as="p" variant="headingLg" fontWeight="bold">{draftCount}</Text>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">품절 · 미연결</Text>
            <Text as="p" variant="headingLg" fontWeight="bold" tone={attentionCount > 0 ? "critical" : undefined}>
              {attentionCount}
            </Text>
          </BlockStack>
        </Box>
      </InlineGrid>
    </Card>
  );
}
