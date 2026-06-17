import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.store-label.css?url";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const CODE128_CHARS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","11000111010"
];
const CODE128_START_B = 104;
const CODE128_STOP = "1100011101011";

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

const euroFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function encodeCode128(text) {
  let checksum = CODE128_START_B;
  const bars = [CODE128_CHARS[CODE128_START_B]];

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index) - 32;
    if (code < 0 || code > 94) continue;
    checksum += code * (index + 1);
    bars.push(CODE128_CHARS[code]);
  }

  bars.push(CODE128_CHARS[checksum % 103]);
  bars.push(CODE128_STOP);
  return bars.join("");
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "fetch_label_product") {
    return null;
  }

  const rawCode = String(formData.get("barcode") || "").trim();
  const copiesRequested = String(formData.get("copies") || "1");

  if (!rawCode) {
    return jsonResponse({ error: "바코드 또는 SKU를 입력하세요." });
  }

  const escapedCode = rawCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const searchQueries = Array.from(new Set([
    `barcode:${rawCode}`,
    `barcode:\"${escapedCode}\"`,
    `sku:${rawCode}`,
    `sku:\"${escapedCode}\"`,
  ]));

  for (const query of searchQueries) {
    const response = await admin.graphql(
      `#graphql
      query findLabelVariant($query: String!) {
        productVariants(first: 1, query: $query) {
          nodes {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            product {
              title
              germanTranslation: metafield(namespace: "global", key: "german_translation") {
                value
              }
              expiryDate: metafield(namespace: "freshly", key: "expiry_date") {
                value
              }
            }
          }
        }
      }`,
      { variables: { query } }
    );

    const responseJson = await response.json();

    if (responseJson?.errors?.length) {
      const errMsg = responseJson.errors.map((error) => error.message).join(", ");
      return jsonResponse({ error: `상품 조회 실패: ${errMsg}` });
    }

    const variant = responseJson?.data?.productVariants?.nodes?.[0];

    if (variant) {
      const variantTitle = variant.title === "Default Title" ? "" : (variant.title || "");

      return jsonResponse({
        copiesRequested,
        labelProduct: {
          id: variant.id,
          barcode: variant.barcode || rawCode,
          sku: variant.sku || "",
          price: variant.price || "0",
          compareAtPrice: variant.compareAtPrice || "",
          productTitle: variant.product?.title || "",
          germanTranslation: variant.product?.germanTranslation?.value || "",
          expiryDate: variant.product?.expiryDate?.value || "",
          variantTitle,
        },
      });
    }
  }

  return jsonResponse({ error: "일치하는 상품을 찾지 못했습니다. 바코드 또는 SKU를 확인하세요." });
};

function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return euroFormatter.format(0);
  return euroFormatter.format(amount);
}

function hasDiscount(price, compareAtPrice) {
  const current = Number(price);
  const original = Number(compareAtPrice);
  return Number.isFinite(current) && Number.isFinite(original) && original > current;
}

function Code128({ value, height = 16, moduleWidth = 0.72, fontSize = 5.1, showText = true }) {
  if (!value) return null;

  const encoded = encodeCode128(value);
  const quietZone = 4;
  const totalWidth = encoded.length * moduleWidth;

  let x = quietZone;
  const rects = [];

  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "1") {
      let width = 0;
      while (index < encoded.length && encoded[index] === "1") {
        width += 1;
        index += 1;
      }
      index -= 1;
      rects.push(<rect key={x} x={x} y={0} width={width * moduleWidth} height={height} fill="#111" />);
      x += width * moduleWidth;
      continue;
    }

    let width = 0;
    while (index < encoded.length && encoded[index] === "0") {
      width += 1;
      index += 1;
    }
    index -= 1;
    x += width * moduleWidth;
  }

  return (
    <div className="store-label-barcode">
      <svg xmlns="http://www.w3.org/2000/svg" width={totalWidth + quietZone * 2} height={showText ? height + 7 : height}>
        {rects}
        {showText && (
          <text x={(totalWidth + quietZone * 2) / 2} y={height + 5.5} textAnchor="middle" fontSize={fontSize} fontFamily="monospace" fill="#333">
            {value}
          </text>
        )}
      </svg>
    </div>
  );
}

function StoreLabel({ item, printMode = false }) {
  const displayTitle = item.germanTranslation || item.productTitle || "";
  const showDiscount = hasDiscount(item.price, item.compareAtPrice);

  return (
    <div className={`store-label ${printMode ? "store-label-print" : ""}`}>
      <div className="store-label-topline">
        <div className="store-label-title">{displayTitle}</div>
        {showDiscount && <div className="store-label-badge">Angebot</div>}
      </div>

      {item.productTitle && item.productTitle !== displayTitle && (
        <div className="store-label-subtitle">{item.productTitle}</div>
      )}

      {item.variantTitle && <div className="store-label-variant">{item.variantTitle}</div>}

      {item.expiryDate && <div className="store-label-expiry">MHD {item.expiryDate}</div>}

      <div className="store-label-price-row">
        <div>
          <div className="store-label-price">{formatEuro(item.price)}</div>
          <div className="store-label-tax">inkl. MwSt.</div>
        </div>
        {showDiscount && <div className="store-label-compare">{formatEuro(item.compareAtPrice)}</div>}
      </div>

      {item.barcode && <Code128 value={item.barcode} showText={!printMode} />}

      <div className="store-label-footer">
        <span>{item.sku ? `SKU ${item.sku}` : "SKU -"}</span>
        <span>{item.barcode ? `EAN ${item.barcode}` : "EAN -"}</span>
      </div>
    </div>
  );
}

export default function StoreLabelPage() {
  const fetcher = useFetcher();
  const [lookupCode, setLookupCode] = useState("");
  const [labelCopies, setLabelCopies] = useState("1");
  const [activeLabel, setActiveLabel] = useState(null);
  const [queuedLabels, setQueuedLabels] = useState([]);
  const [labelPrintItems, setLabelPrintItems] = useState([]);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (fetcher.data?.labelProduct) {
      const requestedCopies = Math.min(50, Math.max(1, Number.parseInt(fetcher.data.copiesRequested, 10) || 1));
      setActiveLabel(fetcher.data.labelProduct);
      setQueuedLabels((current) => {
        const existingIndex = current.findIndex((item) => item.id === fetcher.data.labelProduct.id);

        if (existingIndex === -1) {
          return [...current, { ...fetcher.data.labelProduct, quantity: requestedCopies }];
        }

        return current.map((item, index) => (
          index === existingIndex ? { ...item, quantity: item.quantity + requestedCopies } : item
        ));
      });
      setMessage({
        tone: "success",
        text: `${fetcher.data.labelProduct.productTitle || "상품"} ${requestedCopies}장을 대기열에 추가했습니다.`,
      });
      setLookupCode("");
      return;
    }

    if (fetcher.data?.error) {
      setMessage({ tone: "error", text: fetcher.data.error });
    }
  }, [fetcher.data]);

  const handleLookup = () => {
    if (!lookupCode.trim()) return;

    const copies = Math.min(50, Math.max(1, Number.parseInt(labelCopies, 10) || 1));

    fetcher.submit(
      {
        intent: "fetch_label_product",
        barcode: lookupCode.trim(),
        copies: String(copies),
      },
      { method: "POST" }
    );
  };

  const handleQueueQuantityChange = (id, quantity) => {
    const nextQuantity = Math.min(50, Math.max(1, Number.parseInt(quantity, 10) || 1));
    setQueuedLabels((current) => current.map((item) => (
      item.id === id ? { ...item, quantity: nextQuantity } : item
    )));
  };

  const handleQueueRemove = (id) => {
    setQueuedLabels((current) => current.filter((item) => item.id !== id));
    setActiveLabel((current) => (current?.id === id ? null : current));
  };

  const handleQueueClear = () => {
    setQueuedLabels([]);
    setActiveLabel(null);
    setLabelPrintItems([]);
  };

  const handlePrint = () => {
    if (queuedLabels.length === 0) return;

    const items = queuedLabels.flatMap((item) => {
      const copies = Math.min(50, Math.max(1, Number.parseInt(item.quantity, 10) || 1));

      return Array.from({ length: copies }, (_, index) => ({
        ...item,
        printKey: `${item.id}-${index}`,
      }));
    });

    setLabelPrintItems(items);

    setTimeout(() => {
      window.print();
    }, 100);
  };

  return (
    <div className="label-page-root">
      <div className="label-page-shell">
        <Page title="매장 에티켓 출력" backAction={{ content: "Home", url: "/app" }}>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="start" gap="400" wrap={true}>
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="h1">Brother QL-700 매장 라벨</Text>
                      <Text as="p" tone="subdued">
                        62mm x 29mm 규격으로 바코드 또는 SKU를 연속 스캔해 여러 상품 라벨을 한 번에 출력합니다.
                      </Text>
                    </BlockStack>
                    <div className="label-chip">62 x 29 mm</div>
                  </InlineStack>

                  <div className="label-form-grid">
                    <label className="label-control label-control-wide">
                      <span className="label-control-caption">상품 바코드 또는 SKU</span>
                      <input
                        className="label-control-input"
                        type="text"
                        value={lookupCode}
                        autoFocus
                        placeholder="스캐너 입력 후 Enter"
                        onChange={(event) => setLookupCode(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleLookup();
                          }
                        }}
                      />
                    </label>

                    <label className="label-control label-control-small">
                      <span className="label-control-caption">출력 수량</span>
                      <input
                        className="label-control-input"
                        type="number"
                        min="1"
                        max="50"
                        value={labelCopies}
                        onChange={(event) => setLabelCopies(event.target.value)}
                      />
                    </label>

                    <div className="label-actions">
                      <Button onClick={handleLookup} loading={fetcher.state !== "idle"}>대기열 추가</Button>
                      <Button variant="primary" onClick={handlePrint} disabled={queuedLabels.length === 0}>전체 라벨 인쇄</Button>
                      <Button onClick={handleQueueClear} disabled={queuedLabels.length === 0}>대기열 비우기</Button>
                    </div>
                  </div>

                  {message && (
                    <div className={`label-message ${message.tone === "error" ? "label-message-error" : "label-message-success"}`}>
                      {message.text}
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">출력 대기열</Text>
                    <Text as="p" tone="subdued">총 {queuedLabels.reduce((sum, item) => sum + item.quantity, 0)}장</Text>
                  </InlineStack>

                  {queuedLabels.length > 0 ? (
                    <div className="label-queue-list">
                      {queuedLabels.map((item) => (
                        <div key={item.id} className="label-queue-item">
                          <div className="label-queue-copy">
                            <StoreLabel item={item} />
                          </div>
                          <div className="label-queue-meta">
                            <div className="label-queue-title">{item.germanTranslation || item.productTitle}</div>
                            <div className="label-queue-subtitle">{item.sku ? `SKU ${item.sku}` : "SKU 없음"}</div>
                            {item.expiryDate && <div className="label-queue-subtitle">MHD {item.expiryDate}</div>}
                          </div>
                          <label className="label-queue-qty">
                            <span>Menge</span>
                            <input
                              className="label-control-input"
                              type="number"
                              min="1"
                              max="50"
                              value={String(item.quantity)}
                              onChange={(event) => handleQueueQuantityChange(item.id, event.target.value)}
                            />
                          </label>
                          <Button onClick={() => handleQueueRemove(item.id)}>삭제</Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="label-empty-state">
                      스캔한 상품이 아직 없습니다. 계속 스캔해서 출력 대기열을 쌓으세요.
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">라벨 미리보기</Text>
                  <Text as="p" tone="subdued">
                    독일어 번역명, 유통기한, Code128 바코드, 할인 가격을 함께 표시합니다.
                  </Text>

                  {activeLabel ? (
                    <div className="label-preview-stage">
                      <StoreLabel item={activeLabel} />
                    </div>
                  ) : (
                    <div className="label-empty-state">
                      라벨을 만들 상품을 먼저 조회하세요.
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </div>

      {labelPrintItems.length > 0 && (
        <div className="label-print-sheet">
          {labelPrintItems.map((item) => (
            <StoreLabel key={item.printKey} item={item} printMode={true} />
          ))}
        </div>
      )}
    </div>
  );
}