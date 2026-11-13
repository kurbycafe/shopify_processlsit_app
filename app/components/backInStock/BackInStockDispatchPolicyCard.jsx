import { useState, useEffect } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Select,
  TextField,
  FormLayout,
  Divider,
} from "@shopify/polaris";

const DISPATCH_MODE_OPTIONS = [
  { label: "입고 시 대기 고객 전체 발송 (기본)", value: "ALL" },
  { label: "가용 재고 수량 기반 선착순(FIFO) 분할 발송", value: "FIFO_STOCK" },
];

export default function BackInStockDispatchPolicyCard({
  dispatchPolicy,
  onSavePolicy,
  isSavingPolicy = false,
}) {
  const initialMode = dispatchPolicy?.dispatchMode === "FIFO_STOCK" ? "FIFO_STOCK" : "ALL";
  const initialMultiplier = String(dispatchPolicy?.fifoMultiplier || 1);
  const initialThreshold = String(dispatchPolicy?.minStockThreshold || 1);

  const [isExpanded, setIsExpanded] = useState(false);
  const [dispatchMode, setDispatchMode] = useState(initialMode);
  const [fifoMultiplier, setFifoMultiplier] = useState(initialMultiplier);
  const [minStockThreshold, setMinStockThreshold] = useState(initialThreshold);

  useEffect(() => {
    setDispatchMode(dispatchPolicy?.dispatchMode === "FIFO_STOCK" ? "FIFO_STOCK" : "ALL");
    setFifoMultiplier(String(dispatchPolicy?.fifoMultiplier || 1));
    setMinStockThreshold(String(dispatchPolicy?.minStockThreshold || 1));
  }, [dispatchPolicy?.dispatchMode, dispatchPolicy?.fifoMultiplier, dispatchPolicy?.minStockThreshold]);

  const handleSave = () => {
    if (isSavingPolicy) return;
    onSavePolicy({
      dispatchMode,
      fifoMultiplier,
      minStockThreshold,
    });
  };

  const activeThreshold = Number(dispatchPolicy?.minStockThreshold || 1);
  const activeMultiplier = Number(dispatchPolicy?.fifoMultiplier || 1);
  const isFifoActive = dispatchPolicy?.dispatchMode === "FIFO_STOCK";

  return (
    <Card padding="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap gap="200">
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h3" variant="headingSm">
              재입고 자동 발송 기준
            </Text>
            <Badge tone={isFifoActive ? "info" : "subdued"}>
              {isFifoActive
                ? `선착순(FIFO) · 가용재고 x ${activeMultiplier}명`
                : "전량 일괄 발송"}
            </Badge>
            <Badge tone={activeThreshold > 1 ? "attention" : "subdued"}>
              {`최소 재고 기준: ${activeThreshold}개 이상`}
            </Badge>
          </InlineStack>

          <Button size="slim" onClick={() => setIsExpanded((prev) => !prev)}>
            {isExpanded ? "설정 접기" : "발송 정책 설정"}
          </Button>
        </InlineStack>

        {isExpanded && (
          <>
            <Divider />
            <FormLayout>
              <FormLayout.Group condensed>
                <Select
                  label="자동 발송 방식 (웹훅 · 스캔 공통)"
                  options={DISPATCH_MODE_OPTIONS}
                  value={dispatchMode}
                  onChange={setDispatchMode}
                  helpText="선착순 분할 선택 시 신청 일시(subscribedAt)가 빠른 고객부터 순서대로 알림이 발송됩니다."
                />

                <TextField
                  label="최소 발송 재고 기준 (개)"
                  type="number"
                  min={1}
                  max={1000}
                  value={minStockThreshold}
                  onChange={setMinStockThreshold}
                  autoComplete="off"
                  helpText="설정 수량 미만(예: 소량 반품)으로 재고가 복구될 때는 알림을 보류합니다."
                />

                {dispatchMode === "FIFO_STOCK" && (
                  <TextField
                    label="재고 1개당 발송 배수"
                    type="number"
                    min={1}
                    max={10}
                    value={fifoMultiplier}
                    onChange={setFifoMultiplier}
                    autoComplete="off"
                    helpText="예: 재고 3개 × 2배 = 선착순 6명 발송, 나머지 대기자 PENDING 유지"
                  />
                )}
              </FormLayout.Group>
            </FormLayout>

            <InlineStack align="end">
              <Button
                variant="primary"
                loading={isSavingPolicy}
                disabled={isSavingPolicy}
                onClick={handleSave}
              >
                발송 정책 저장
              </Button>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

