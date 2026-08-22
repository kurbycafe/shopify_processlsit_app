import {
  InlineStack,
  Text,
  Button,
  Select,
  Box,
} from "@shopify/polaris";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";

export default function CommonPagination({
  currentPage = 1,
  totalPages = 1,
  totalCount = 0,
  limit = 25,
  onChangePage,
  onChangeLimit,
}) {
  const startItem = totalCount === 0 ? 0 : (currentPage - 1) * limit + 1;
  const endItem = Math.min(currentPage * limit, totalCount);

  return (
    <Box padding="300">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          {onChangeLimit && (
            <>
              <Text variant="bodySm" tone="subdued">
                표시 개수:
              </Text>
              <div style={{ width: "90px" }}>
                <Select
                  options={[
                    { label: "25개", value: "25" },
                    { label: "50개", value: "50" },
                    { label: "100개", value: "100" },
                  ]}
                  value={String(limit)}
                  onChange={(val) => onChangeLimit(Number(val))}
                />
              </div>
            </>
          )}
          <Text variant="bodySm" tone="subdued">
            {`총 ${totalCount.toLocaleString()}개 중 ${startItem}–${endItem}번째`}
          </Text>
        </InlineStack>

        <InlineStack gap="150" blockAlign="center">
          <Button
            size="slim"
            disabled={currentPage <= 1}
            onClick={() => onChangePage(1)}
          >
            처음
          </Button>
          <Button
            size="slim"
            icon={ChevronLeftIcon}
            disabled={currentPage <= 1}
            onClick={() => onChangePage(currentPage - 1)}
          >
            이전
          </Button>

          <Text variant="bodySm" fontWeight="semibold">
            {`${currentPage} / ${Math.max(totalPages, 1)} 페이지`}
          </Text>

          <Button
            size="slim"
            icon={ChevronRightIcon}
            disabled={currentPage >= totalPages}
            onClick={() => onChangePage(currentPage + 1)}
          >
            다음
          </Button>
          <Button
            size="slim"
            disabled={currentPage >= totalPages}
            onClick={() => onChangePage(totalPages)}
          >
            마지막
          </Button>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}
