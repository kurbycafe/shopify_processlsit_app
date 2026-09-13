import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";

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
  return (
    <div className="ops-metric" data-tone={variant} data-active={active}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${title}: ${value}. ${badgeText || '목록 보기'}` : undefined}
      onClick={onClick} onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); }
      } : undefined}>
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

    </div>
  );
}
