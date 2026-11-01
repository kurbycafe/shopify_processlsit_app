import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineGrid,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  ODOO_SKU_CATEGORY_OPTIONS,
  inferOdooSkuPrefix,
  computeNextAvailableSku,
  validateOdooSkuFormat,
} from "../utils/odooSkuCategories.js";

/**
 * Polaris card for assigning Odoo-standard SKUs to unregistered/SKU-less container items
 * and syncing them atomically to both Odoo ERP and Shopify with duplicate prevention.
 */
export function MissingSkuManagerCard({
  containerRef,
  missingItems = [],
  allContainerSkus = [],
  nextSkuByPrefix = {},
  applying = false,
  resultBanner = null,
  onApplySkus,
}) {
  const [drafts, setDrafts] = useState({});
  const [createInShopify, setCreateInShopify] = useState(true);
  const [confirmTargets, setConfirmTargets] = useState(null);

  // Build initial duplicate-free SKU drafts whenever missingItems or nextSkuByPrefix changes
  const initialDrafts = useMemo(() => {
    const usedSet = new Set(
      allContainerSkus
        .map((s) => String(s || "").trim().toUpperCase())
        .filter(Boolean)
    );
    // Seed usedSet with all known max sequences from nextSkuByPrefix (subtract 1 to represent highest existing)
    for (const [prefix, nextSku] of Object.entries(nextSkuByPrefix || {})) {
      if (!nextSku || !nextSku.startsWith(prefix)) continue;
      const num = Number.parseInt(nextSku.slice(prefix.length), 10);
      if (Number.isFinite(num) && num > 1) {
        usedSet.add(`${prefix}${String(num - 1).padStart(3, "0")}`);
      }
    }

    const map = {};
    missingItems.forEach((item, idx) => {
      const key = item.rowKey || item.itemId || `${item.odooName || item.productName || "item"}-${idx}`;
      const name = item.odooName || item.productName || item.name || "";
      const prefix = (item.suggestedPrefix || inferOdooSkuPrefix(name)).toUpperCase();
      let suggestedSku = item.suggestedSku
        ? String(item.suggestedSku).trim().toUpperCase()
        : "";

      if (!suggestedSku || usedSet.has(suggestedSku)) {
        suggestedSku = computeNextAvailableSku(prefix, usedSet);
      }
      usedSet.add(suggestedSku);

      map[key] = {
        key,
        itemId: item.itemId || null,
        odooProductId: item.odooProductId || null,
        productName: name,
        prefix,
        sku: suggestedSku,
        barcode:
          item.barcode && item.barcode !== "N/A" ? String(item.barcode) : "",
        wholesalePrice: item.wholesalePrice || 0,
        retailPrice: item.retailPrice || 0,
        shopifyMatchedByTitle: Boolean(item.shopifyMatchedByTitle || item.linked),
        existingShopifySku: item.existingShopifySku || "",
      };
    });
    return map;
  }, [missingItems, allContainerSkus, nextSkuByPrefix]);

  useEffect(() => {
    setDrafts(initialDrafts);
  }, [initialDrafts]);

  const rows = useMemo(
    () =>
      missingItems.map((item, idx) => {
        const key =
          item.rowKey ||
          item.itemId ||
          `${item.odooName || item.productName || "item"}-${idx}`;
        return drafts[key] || initialDrafts[key];
      }).filter(Boolean),
    [missingItems, drafts, initialDrafts]
  );

  // Live duplicate & format validation across the current container and draft batch
  const validationByKey = useMemo(() => {
    const existingUpper = new Set(
      allContainerSkus
        .map((s) => String(s || "").trim().toUpperCase())
        .filter(Boolean)
    );
    const countsInDraft = new Map();
    for (const row of rows) {
      const clean = String(row.sku || "").trim().toUpperCase();
      if (clean) {
        countsInDraft.set(clean, (countsInDraft.get(clean) || 0) + 1);
      }
    }

    const result = {};
    for (const row of rows) {
      const check = validateOdooSkuFormat(row.sku);
      if (!check.valid) {
        result[row.key] = { valid: false, error: check.error };
        continue;
      }
      if ((countsInDraft.get(check.normalized) || 0) > 1) {
        result[row.key] = {
          valid: false,
          error: "입력 중인 다른 미등록 품목과 SKU가 중복됩니다.",
        };
        continue;
      }
      if (
        existingUpper.has(check.normalized) &&
        check.normalized !== String(row.existingShopifySku || "").toUpperCase()
      ) {
        result[row.key] = {
          valid: false,
          error: "이미 컨테이너 내 다른 품목에서 사용 중인 SKU입니다.",
        };
        continue;
      }
      result[row.key] = { valid: true, error: null };
    }
    return result;
  }, [rows, allContainerSkus]);

  const handlePrefixChange = (rowKey, newPrefix) => {
    setDrafts((prev) => {
      const usedSet = new Set(
        allContainerSkus
          .map((s) => String(s || "").trim().toUpperCase())
          .filter(Boolean)
      );
      const baseNext = nextSkuByPrefix?.[newPrefix];
      if (baseNext && baseNext.startsWith(newPrefix)) {
        const num = Number.parseInt(baseNext.slice(newPrefix.length), 10);
        if (Number.isFinite(num) && num > 1) {
          usedSet.add(`${newPrefix}${String(num - 1).padStart(3, "0")}`);
        }
      }
      for (const [k, d] of Object.entries(prev)) {
        if (k !== rowKey && d?.sku) {
          usedSet.add(String(d.sku).trim().toUpperCase());
        }
      }
      const nextSku = computeNextAvailableSku(newPrefix, usedSet);
      return {
        ...prev,
        [rowKey]: {
          ...prev[rowKey],
          prefix: newPrefix,
          sku: nextSku,
        },
      };
    });
  };

  const handleFieldChange = (rowKey, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [rowKey]: {
        ...prev[rowKey],
        [field]: field === "sku" ? String(value || "").toUpperCase() : value,
      },
    }));
  };

  const allValid =
    rows.length > 0 && rows.every((r) => validationByKey[r.key]?.valid);

  const openConfirmFor = (targetRows) => {
    const invalid = targetRows.find((r) => !validationByKey[r.key]?.valid);
    if (invalid) return;
    setConfirmTargets(targetRows);
  };

  const handleConfirmSubmit = () => {
    if (!confirmTargets || !onApplySkus) return;
    const payload = confirmTargets.map((r) => ({
      itemId: r.itemId,
      odooProductId: r.odooProductId,
      productName: r.productName,
      sku: String(r.sku || "").trim().toUpperCase(),
      barcode: String(r.barcode || "").trim(),
      wholesalePrice: r.wholesalePrice,
      retailPrice: r.retailPrice,
    }));
    setConfirmTargets(null);
    onApplySkus({
      assignments: payload,
      createInShopifyIfMissing: createInShopify,
    });
  };

  if (rows.length === 0) return null;

  return (
    <>
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingSm">
                  SKU 미등록 상품 자동 설정 (Odoo 기준 채번 · Odoo & Shopify 동시 적용)
                </Text>
                <Badge tone="warning">{`미등록 ${rows.length}개`}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                상품명을 분석해 다와요 Odoo 카테고리 규칙(예: C40 즉석국·탕, B20 양념·고춧가루)에 맞는 다음 번호를 자동 추천합니다. 적용 시 Odoo와 Shopify 양쪽 중복 여부를 검증한 뒤 동시 반영됩니다.
              </Text>
            </BlockStack>
            <Button
              variant="primary"
              disabled={!allValid || applying}
              loading={applying}
              onClick={() => openConfirmFor(rows)}
            >
              {`미등록 ${rows.length}개 전체 SKU 일괄 적용`}
            </Button>
          </InlineStack>

          {resultBanner && (
            <Banner tone={resultBanner.ok ? "success" : "critical"}>
              <p>{resultBanner.message}</p>
            </Banner>
          )}

          <Checkbox
            label="Shopify 스토어에 아직 없는 상품인 경우 초안(DRAFT) 상품으로 자동 등록 후 SKU 연결"
            checked={createInShopify}
            onChange={setCreateInShopify}
          />

          <Divider />

          <BlockStack gap="300">
            {rows.map((row) => {
              const validation = validationByKey[row.key] || { valid: true };
              return (
                <Box
                  key={row.key}
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="bold" variant="bodyMd">
                          {row.productName}
                        </Text>
                        {row.existingShopifySku ? (
                          <Badge tone="info">{`Shopify 기존 SKU: ${row.existingShopifySku}`}</Badge>
                        ) : row.shopifyMatchedByTitle ? (
                          <Badge tone="success">Shopify 제목 일치 상품 있음</Badge>
                        ) : (
                          <Badge tone="attention">Shopify 미등록 (초안 생성 대상)</Badge>
                        )}
                      </InlineStack>
                      <Button
                        size="slim"
                        disabled={!validation.valid || applying}
                        loading={applying}
                        onClick={() => openConfirmFor([row])}
                      >
                        이 품목만 SKU 적용
                      </Button>
                    </InlineStack>

                    <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                      <Select
                        label="Odoo 카테고리 분류"
                        options={ODOO_SKU_CATEGORY_OPTIONS}
                        value={row.prefix}
                        onChange={(val) => handlePrefixChange(row.key, val)}
                      />
                      <TextField
                        label="적용할 SKU (Odoo & Shopify 공통)"
                        value={row.sku}
                        onChange={(val) => handleFieldChange(row.key, "sku", val)}
                        autoComplete="off"
                        error={validation.error || undefined}
                        helpText={
                          !validation.error
                            ? "Odoo·Shopify·DB 중복 검사를 통과한 추천 번호입니다."
                            : undefined
                        }
                      />
                      <TextField
                        label="바코드 (선택 입력)"
                        value={row.barcode}
                        placeholder="바코드가 있으면 입력"
                        onChange={(val) =>
                          handleFieldChange(row.key, "barcode", val)
                        }
                        autoComplete="off"
                      />
                    </InlineGrid>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>

      <Modal
        open={Boolean(confirmTargets)}
        onClose={() => setConfirmTargets(null)}
        title="Odoo 및 Shopify SKU 동시 적용 확인"
        primaryAction={{
          content: "중복 검증 및 양방향 적용",
          onAction: handleConfirmSubmit,
          loading: applying,
        }}
        secondaryActions={[
          {
            content: "취소",
            onAction: () => setConfirmTargets(null),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              {containerRef ? `[${containerRef}] ` : ""}
              아래 {confirmTargets?.length || 0}개 품목의 SKU를 Odoo ERP(`product.product`)와 Shopify 스토어에 동시에 적용하시겠습니까?
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              적용 전 Odoo와 Shopify 전체 상품에 대해 SKU 중복 여부를 최종 확인하며, 다른 상품이 이미 사용 중인 번호는 차단됩니다.
            </Text>
            <Divider />
            <BlockStack gap="100">
              {(confirmTargets || []).map((target) => (
                <InlineStack
                  key={target.key}
                  align="space-between"
                  blockAlign="center"
                >
                  <Text as="span">{target.productName}</Text>
                  <Badge tone="info">{target.sku}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

