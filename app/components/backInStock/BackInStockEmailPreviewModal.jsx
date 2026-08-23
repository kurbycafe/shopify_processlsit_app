import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Card,
  Box,
} from "@shopify/polaris";
import dayjs from "dayjs";
import { buildBackInStockEmailHtml } from "../../utils/emailService";

export default function BackInStockEmailPreviewModal({
  open,
  onClose,
  productItem,
  shopDomain,
}) {
  if (!productItem) return null;

  const displayPo = productItem.poNumber || "PO00412";
  const displayDate = productItem.notifiedAt ? new Date(productItem.notifiedAt) : new Date();

  const htmlContent = buildBackInStockEmailHtml({
    productTitle: productItem.productTitle || "DAWAYO K-Food Item",
    variantTitle: productItem.variantTitle || "",
    productUrl: `https://${shopDomain || "dawayo.de"}`,
    shopDomain: shopDomain || "dawayo.de",
    poNumber: displayPo,
    dispatchDate: displayDate,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="재입고 알림 이메일 템플릿 실시간 미리보기 (Email Preview)"
      size="large"
      secondaryActions={[
        {
          content: "닫기",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Card padding="300" background="bg-surface-secondary">
            <BlockStack gap="150">
              <InlineStack gap="200">
                <Text variant="bodySm" fontWeight="bold">발신자:</Text>
                <Text variant="bodySm">Dawayo K-Food &lt;popeye.gmbh@gmail.com&gt;</Text>
              </InlineStack>
              <InlineStack gap="200">
                <Text variant="bodySm" fontWeight="bold">제목:</Text>
                <Text variant="bodySm">{`[Dawayo] Wieder auf Lager: ${productItem.productTitle} [PO: ${displayPo}] / 재입고 알림`}</Text>
              </InlineStack>
              <InlineStack gap="300" wrap>
                <InlineStack gap="100">
                  <Text variant="bodySm" fontWeight="bold">입고 Odoo PO:</Text>
                  <Badge tone="info">{displayPo}</Badge>
                </InlineStack>
                <InlineStack gap="100">
                  <Text variant="bodySm" fontWeight="bold">발송 일시:</Text>
                  <Text variant="bodySm">{dayjs(displayDate).format("YYYY-MM-DD HH:mm")}</Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Text variant="bodySm" fontWeight="bold">언어 구성:</Text>
                  <Badge tone="info">독일어(DE) 기본 + 한국어(KO) 보조 병기</Badge>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>

          <Box
            padding="200"
            style={{
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              maxHeight: "520px",
              overflowY: "auto",
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
