import { Card, InlineGrid, InlineStack, BlockStack, Text, Badge, Box } from "@shopify/polaris";

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
            <Text as="span" variant="bodySm" tone="subdued">전체 레시피 (Total)</Text>
            <Text as="p" variant="headingLg" fontWeight="bold">{totalCount}</Text>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">게시 완료 (Published)</Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{publishedCount}</Text>
              <Badge tone="success">Shopify 라이브</Badge>
            </InlineStack>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">임시 초안 (Draft)</Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="headingLg" fontWeight="bold">{draftCount}</Text>
              <Badge tone="warning">DB 저장됨</Badge>
            </InlineStack>
          </BlockStack>
        </Box>

        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">관리 주의 (Needs Attention)</Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="headingLg" fontWeight="bold" tone={attentionCount > 0 ? "critical" : "subdued"}>
                {attentionCount}
              </Text>
              {attentionCount > 0 ? (
                <Badge tone="critical">품절/미매칭</Badge>
              ) : (
                <Badge tone="success">정상</Badge>
              )}
            </InlineStack>
          </BlockStack>
        </Box>
      </InlineGrid>
    </Card>
  );
}
