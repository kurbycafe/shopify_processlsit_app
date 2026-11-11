import { Card, BlockStack, InlineStack, Text, Badge, Divider } from "@shopify/polaris";
import { SYSTEM_UPDATES } from "../../constants/systemUpdates.js";

function UpdateEntry({ update }) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingSm" as="h3">
          {update.title}
        </Text>
        <Text variant="bodySm" tone="subdued">
          {update.date}
        </Text>
      </InlineStack>

      <ul className="ops-update-list">
        {update.items.map((item) => (
          <li key={item.text}>
            {item.label && <strong>{item.label}: </strong>}
            {item.text}
          </li>
        ))}
      </ul>
    </BlockStack>
  );
}

export function DashboardSystemUpdateCard({ updates = SYSTEM_UPDATES }) {
  const [latest, ...previous] = updates;
  if (!latest) return null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            시스템 업데이트 내역
          </Text>
          <Badge>{latest.version}</Badge>
        </InlineStack>

        <Divider />

        <UpdateEntry update={latest} />

        {previous.length > 0 && (
          <>
            <Divider />
            <details className="ops-update-details">
              <summary>
                이전 업데이트 내역 보기 · {previous[0].date} ({previous[0].version})
              </summary>
              <div className="ops-update-previous">
                <BlockStack gap="400">
                  {previous.map((update) => (
                    <UpdateEntry key={update.version} update={update} />
                  ))}
                </BlockStack>
              </div>
            </details>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
