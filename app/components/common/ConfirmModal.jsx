import { Modal, Text, BlockStack, Banner } from "@shopify/polaris";

/**
 * Standardized Context-Rich Confirmation Modal
 */
export default function ConfirmModal({
  open,
  title,
  message,
  impactSummary,
  confirmLabel = "확인",
  cancelLabel = "취소",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      primaryAction={{
        content: confirmLabel,
        destructive,
        loading,
        onAction: onConfirm,
      }}
      secondaryActions={[
        {
          content: cancelLabel,
          disabled: loading,
          onAction: onCancel,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            {message}
          </Text>

          {impactSummary && (
            <Banner tone={destructive ? "critical" : "warning"}>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {impactSummary}
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
