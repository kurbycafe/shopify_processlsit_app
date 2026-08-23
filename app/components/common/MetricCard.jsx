import { Box, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";

/**
 * Three-tier visual weight Metric Card for Operations Dashboards & KPI Grids
 */
export default function MetricCard({
  title,
  value,
  subtitle,
  badgeText,
  badgeTone = "info",
  variant = "secondary", // "primary" | "secondary" | "critical" | "warning"
  onClick,
  active = false,
}) {
  let borderColor = "var(--p-color-border)";
  let bg = "var(--p-color-bg-surface)";
  let valueColor = "var(--p-color-text)";

  if (variant === "primary") {
    borderColor = "var(--p-color-border-brand)";
    bg = "var(--p-color-bg-surface-brand-active)";
  } else if (variant === "critical") {
    borderColor = "var(--p-color-border-critical)";
    valueColor = "var(--p-color-text-critical)";
  } else if (variant === "warning") {
    borderColor = "var(--p-color-border-warning)";
    valueColor = "var(--p-color-text-warning)";
  }

  if (active) {
    borderColor = "var(--p-color-border-interactive-active)";
  }

  return (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        transition: "all 0.15s ease-in-out",
      }}
    >
      <Box
        padding="400"
        background="bg-surface"
        borderRadius="300"
        borderWidth="025"
        borderColor={variant === "critical" ? "border-critical" : variant === "primary" ? "border-brand" : "border"}
        shadow="100"
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodySm" tone="subdued" fontWeight="semibold">
              {title}
            </Text>
            {badgeText && <Badge tone={badgeTone} size="small">{badgeText}</Badge>}
          </InlineStack>

          <InlineStack align="start" blockAlign="baseline" gap="200">
            <Text variant="heading2xl" as="p" fontWeight="bold" tone={variant === "critical" ? "critical" : undefined}>
              {typeof value === "number" ? value.toLocaleString() : value}
            </Text>
            {subtitle && (
              <Text variant="bodyXs" tone="subdued">
                {subtitle}
              </Text>
            )}
          </InlineStack>
        </BlockStack>
      </Box>
    </div>
  );
}
