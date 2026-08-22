import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  InlineGrid,
  Box,
  Icon,
} from "@shopify/polaris";

export default function CommonKpiGrid({
  items = [],
  activeKey,
  onSelectKey,
  columns = { xs: 1, sm: 2, md: 3, lg: 4 },
}) {
  if (!items || items.length === 0) return null;

  return (
    <InlineGrid columns={columns} gap="300">
      {items.map((item) => {
        const isSelected = activeKey === item.id;

        return (
          <div
            key={item.id}
            onClick={() => onSelectKey && onSelectKey(item.id)}
            style={{
              cursor: onSelectKey ? "pointer" : "default",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
          >
            <Card padding="300">
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center">
                  <Text
                    variant="bodySm"
                    fontWeight="semibold"
                    tone={item.tone === "critical" ? "critical" : undefined}
                    truncate
                  >
                    {item.title}
                  </Text>
                  {item.icon && <Icon source={item.icon} tone={item.tone} />}
                </InlineStack>

                <InlineStack align="start" blockAlign="baseline" gap="100">
                  <Text
                    variant="headingXl"
                    as="p"
                    fontWeight="bold"
                    tone={item.tone}
                  >
                    {typeof item.count === "number"
                      ? item.count.toLocaleString()
                      : item.count || "0"}
                  </Text>
                  {item.unit && (
                    <Text variant="bodyXs" tone="subdued">
                      {item.unit}
                    </Text>
                  )}
                </InlineStack>

                {item.subtext && (
                  <Text variant="bodyXs" tone="subdued" truncate>
                    {item.subtext}
                  </Text>
                )}

                {isSelected && (
                  <Box
                    padding="050"
                    style={{
                      borderBottom: "3px solid #008060",
                      marginTop: "4px",
                    }}
                  />
                )}
              </BlockStack>
            </Card>
          </div>
        );
      })}
    </InlineGrid>
  );
}
