import { InlineGrid } from "@shopify/polaris";
import MetricCard from "./MetricCard.jsx";

function mapToneToVariant(tone) {
  if (tone === "critical") return "critical";
  if (tone === "warning" || tone === "attention") return "warning";
  if (tone === "success") return "primary";
  return "secondary";
}

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
          <MetricCard
            key={item.id}
            title={item.title}
            value={item.count ?? 0}
            subtitle={item.unit}
            subtext={item.subtext}
            icon={item.icon}
            iconTone={item.tone}
            variant={mapToneToVariant(item.tone)}
            active={isSelected}
            onClick={onSelectKey ? () => onSelectKey(item.id) : undefined}
          />
        );
      })}
    </InlineGrid>
  );
}
