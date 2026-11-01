import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { Badge, Banner, BlockStack, Box, Button, Card, Checkbox, Divider, IndexTable, InlineGrid, InlineStack, Modal, Page, Select, Text, TextField, Thumbnail } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveCanonicalShop, parseExtendedSettings } from "../services/mobileStorefront.server.js";
import { saveStorefrontConfig } from "../services/productTemperatures.server.js";
import { getShopAliases } from "../services/subscriptionService.server.js";
import { arrivalItemCode, resolveArrivalSkus } from "../services/customerResources.server.js";
import { getOdooRpc } from "../services/odooClient.server.js";
import { syncOdooArrivals } from "../services/arrivalsSync.server.js";
import { collectExistingSkus, suggestAvailableSkus, applySkusToOdooAndShopify } from "../services/skuSync.server.js";
import { ODOO_SKU_CATEGORIES, computeNextAvailableSku } from "../utils/odooSkuCategories.js";
import { MissingSkuManagerCard } from "../components/MissingSkuManagerCard.jsx";
import { normalizeArrivalCopy, normalizeArrivalSelection, normalizeArrivalOverrides, arrivalItemKey } from "../utils/arrivalCopy.js";

// The app's arrival board, in the order it is set up: pick the one Odoo
// receipt the app home shows (after a confirmation), pick up to five of its
// products for the home card preview, then optional details and wording.
const MAX_PICKS = 5;
// Items read per receipt; the confirm window lists them all.
const ITEM_LIMIT = 300;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const [config, containers] = await Promise.all([
    prisma.mobileStorefrontConfig.findUnique({ where: { shop } }),
    prisma.container.findMany({
      // Every open Odoo receipt, also overdue or undated ones, so any can be chosen.
      where: { shop: { in: getShopAliases(session.shop) }, status: { in: ["SCHEDULED", "IN_TRANSIT"] } },
      orderBy: [{ scheduledDate: { sort: "desc", nulls: "last" } }, { id: "desc" }], take: 50,
      select: { id: true, containerRef: true, supplier: true, status: true, arrivalKind: true, scheduledDate: true, syncedAt: true,
        _count: { select: { items: true } },
        items: { orderBy: { id: "asc" }, take: ITEM_LIMIT, select: { id: true, sku: true, barcode: true, productName: true, expectedQty: true } } },
    }),
  ]);
  const missingTargets = containers.flatMap((c) =>
    c.items
      .filter((item) => !item.sku)
      .map((item) => ({
        itemId: item.id,
        productName: item.productName,
        barcode: item.barcode || "",
      }))
  );
  const graphql = (_shop, query, variables) => admin.graphql(query, { variables }).then((response) => response.json());
  const [links, skuSuggestionResult] = await Promise.all([
    resolveArrivalSkus({ graphql, shop: session.shop, codes: containers.flatMap((c) => c.items.map(arrivalItemCode)) }),
    missingTargets.length > 0
      ? getOdooRpc()
          .catch(() => null)
          .then((rpc) =>
            suggestAvailableSkus({
              db: prisma,
              admin,
              rpc,
              items: missingTargets,
            })
          )
          .catch(() => null)
      : collectExistingSkus({ db: prisma, prefixes: [] }).then((usedSkus) => {
          const map = {};
          for (const cat of ODOO_SKU_CATEGORIES) {
            map[cat.prefix] = computeNextAvailableSku(cat.prefix, usedSkus);
          }
          return { suggestions: [], nextSkuByPrefix: map };
        }),
  ]);
  const nextSkuByPrefix = skuSuggestionResult?.nextSkuByPrefix || {};
  const suggestionByItemId = new Map(
    (skuSuggestionResult?.suggestions || []).map((s) => [s.itemId, s])
  );
  const settings = parseExtendedSettings(config?.tickersJson);
  return {
    copy: normalizeArrivalCopy(settings.arrivalCopy),
    selection: normalizeArrivalSelection(settings.arrivalSelection),
    overrides: normalizeArrivalOverrides(settings.arrivalOverrides),
    nextSkuByPrefix,
    lastSyncedAt: containers.reduce((latest, c) => (!latest || c.syncedAt > latest ? c.syncedAt : latest), null),
    containers: containers.map((c) => ({
      id: c.id, ref: c.containerRef, supplier: c.supplier, status: c.status, odooDate: c.scheduledDate,
      odooKind: c.arrivalKind === "DOMESTIC" ? "domestic" : "container",
      itemCount: c._count?.items ?? c.items.length,
      items: c.items.map((item) => {
        const link = links.get(arrivalItemCode(item));
        const sug = suggestionByItemId.get(item.id);
        return {
          key: arrivalItemKey(c.containerRef, item),
          itemId: item.id,
          name: item.productName,
          productName: item.productName,
          sku: item.sku,
          barcode: item.barcode || sug?.barcode || null,
          qty: item.expectedQty,
          linked: Boolean(link),
          image: link?.image || sug?.shopifyMatch?.imageUrl || null,
          suggestedPrefix: sug?.prefix || null,
          suggestedSku: sug?.suggestedSku || null,
          shopifyMatchedByTitle: Boolean(link || sug?.shopifyMatch),
          existingShopifySku: sug?.shopifyMatch?.existingSku || "",
        };
      }),
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "sync") {
    try {
      const result = await syncOdooArrivals({ db: prisma, shop: session.shop, rpc: await getOdooRpc() });
      return { ok: true, message: `Odoo에서 ${result.synced}건을 가져왔습니다${result.closed ? `, ${result.closed}건은 입고 완료로 정리했습니다` : ""}${result.failed ? ` (${result.failed}건 실패)` : ""}.` };
    } catch {
      return { ok: false, message: "Odoo에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." };
    }
  }
  if (intent === "assign_skus") {
    const containerRef = String(form.get("containerRef") || "").trim();
    const createInShopifyIfMissing = form.get("createInShopifyIfMissing") === "true";
    const autoResolveCollision = form.get("autoResolveCollision") !== "false";
    let assignments = [];
    try {
      assignments = JSON.parse(String(form.get("assignments") || "[]"));
    } catch {
      return { ok: false, message: "잘못된 SKU 요청 데이터입니다." };
    }
    try {
      const rpc = await getOdooRpc();
      return await applySkusToOdooAndShopify({
        db: prisma,
        admin,
        rpc,
        shop: session.shop,
        containerRef,
        assignments,
        createInShopifyIfMissing,
        autoResolveCollision,
      });
    } catch (err) {
      return { ok: false, message: `SKU 적용 실패: ${err.message}` };
    }
  }
  try {
    const config = await prisma.mobileStorefrontConfig.findUnique({ where: { shop } });
    const settings = parseExtendedSettings(config?.tickersJson);
    const ref = String(form.get("ref") || "").slice(0, 120);
    let tickersJson, message;
    if (intent === "choose") {
      // One arrival on the app home; an empty ref turns the board off.
      const current = normalizeArrivalSelection(settings.arrivalSelection);
      const reviewed = JSON.parse(String(form.get("reviewed") || "[]"));
      const arrivalSelection = normalizeArrivalSelection({ shown: ref ? [ref] : [], hiddenItems: current?.hiddenItems || [], reviewed: [...(current?.reviewed || []), ...(Array.isArray(reviewed) ? reviewed : [])] });
      tickersJson = { arrivalSelection };
      message = ref ? `${ref} 입고를 앱에 표시하도록 설정했습니다. 앱을 다시 열면 반영됩니다.` : "앱 홈의 입고 표시를 껐습니다.";
    } else if (intent === "arrival") {
      if (!ref) throw new Error("invalid");
      const override = JSON.parse(String(form.get("override") || "{}"));
      // At most MAX_PICKS products are picked for the home preview.
      const items = Object.entries(override.items || {}).sort(([, a], [, b]) => (a.order ?? 1000) - (b.order ?? 1000));
      let picked = 0;
      override.items = Object.fromEntries(items.map(([key, setting]) => [key, setting.featured && ++picked > MAX_PICKS ? { ...setting, featured: undefined } : setting]));
      const arrivalOverrides = normalizeArrivalOverrides({ ...normalizeArrivalOverrides(settings.arrivalOverrides), [ref]: override });
      tickersJson = { arrivalOverrides };
      message = form.get("what") === "picks" ? "미리보기 상품을 저장했습니다. 앱을 다시 열면 반영됩니다." : "상세 설정을 저장했습니다. 앱을 다시 열면 반영됩니다.";
    } else {
      tickersJson = { arrivalCopy: normalizeArrivalCopy(JSON.parse(String(form.get("copy") || "{}"))) };
      message = "기본 문구를 저장했습니다. 앱을 다시 열면 반영됩니다.";
    }
    const configVersion = String(Date.now());
    await saveStorefrontConfig(prisma, { where: { shop }, update: { tickersJson, configVersion }, create: { shop, tickersJson, configVersion } });
    return { ok: true, message };
  } catch {
    return { ok: false, message: "저장하지 못했습니다. 새로고침 후 다시 시도해주세요." };
  }
};

const KINDS = [
  ["container", "한국 컨테이너", "{date}에 한국에서 컨테이너가 들어와요!", "한국 컨테이너"],
  ["domestic", "독일 내 입고", "{date}에 새 상품들이 들어와요!", "독일 내 입고"],
];
const KIND_LABEL = { container: "한국 컨테이너", domestic: "독일 내 입고" };
const LANGS = [["ko", "한국어"], ["de", "독일어"], ["en", "영어"]];
const formatDate = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }) : "날짜 미정");
const emptyLangs = { ko: "", de: "", en: "" };
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function LangFields({ label, value, onChange, placeholder, multiline, maxLength }) {
  return (
    <InlineGrid columns={{ xs: 1, md: 3 }} gap="200">
      {LANGS.map(([lang, langName]) => (
        <TextField key={lang} label={`${label} (${langName})`} value={value?.[lang] || ""} placeholder={lang === "ko" ? placeholder : ""} multiline={multiline} maxLength={maxLength} autoComplete="off"
          onChange={(text) => onChange({ ...emptyLangs, ...value, [lang]: text })} />
      ))}
    </InlineGrid>
  );
}

function ItemLine({ item, prefix, showSku }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      {prefix}
      <Thumbnail size="extraSmall" source={item.image || BLANK} alt="" />
      <Text as="span" tone={item.linked ? undefined : "subdued"}>{item.name}</Text>
      <Text as="span" tone="subdued" variant="bodySm">{showSku && item.sku ? `${item.sku} · ` : ""}{item.qty}개{item.linked ? "" : " · 쇼핑몰 미연결"}</Text>
    </InlineStack>
  );
}

// The open Odoo receipts as a table, like the other admin lists. Clicking a
// row opens the confirmation with every incoming product.
function ArrivalTable({ arrivals, chosenRef, isNew, overrideOf, onChoose }) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = arrivals.map((arrival, index) => {
    const override = overrideOf(arrival.ref);
    const date = override.date || arrival.odooDate;
    const kind = override.kind || arrival.odooKind;
    const chosen = arrival.ref === chosenRef;
    const [first] = arrival.items;
    return (
      <IndexTable.Row id={arrival.ref} key={arrival.ref} position={index} selected={chosen} onClick={() => onChoose(chosen ? null : arrival)}>
        <IndexTable.Cell>
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            <Text as="span" fontWeight="semibold">{arrival.ref}</Text>
            {isNew(arrival.ref) && <Badge tone="attention">새 입고</Badge>}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell><Badge tone={kind === "container" ? "critical" : "info"}>{KIND_LABEL[kind]}</Badge></IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone={date && date < today ? "caution" : undefined}>{formatDate(date)}{date && date < today ? " · 지남" : ""}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell><Text as="span" alignment="end" numeric>{arrival.itemCount}</Text></IndexTable.Cell>
        <IndexTable.Cell>
          {first ? (
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Thumbnail size="extraSmall" source={first.image || BLANK} alt="" />
              <Text as="span" truncate>{first.name}{arrival.itemCount > 1 ? ` 외 ${arrival.itemCount - 1}개` : ""}</Text>
            </InlineStack>
          ) : <Text as="span" tone="subdued">-</Text>}
        </IndexTable.Cell>
        <IndexTable.Cell>{chosen ? <Badge tone="success">표시 중</Badge> : <Text as="span" tone="subdued">-</Text>}</IndexTable.Cell>
      </IndexTable.Row>
    );
  });
  return (
    <IndexTable resourceName={{ singular: "입고", plural: "입고" }} itemCount={arrivals.length} selectable={false}
      headings={[{ title: "입고 번호" }, { title: "종류" }, { title: "입고 예정일" }, { title: "품목", alignment: "end" }, { title: "상품" }, { title: "앱 표시" }]}>
      {rows}
    </IndexTable>
  );
}

// Up to MAX_PICKS products of the chosen arrival for the app home card.
function PicksCard({ arrival, override, copy, saving, onSave }) {
  const initial = useMemo(() => Object.entries(override.items || {}).filter(([, s]) => s.featured)
    .sort(([, a], [, b]) => (a.order ?? 1000) - (b.order ?? 1000)).map(([key]) => key)
    .filter((key) => arrival.items.some((item) => item.key === key && item.linked)), [arrival, override]);
  const [picks, setPicks] = useState(initial);
  useEffect(() => setPicks(initial), [initial]);
  const dirty = picks.join("|") !== initial.join("|");
  const toggle = (key) => setPicks((current) => current.includes(key) ? current.filter((k) => k !== key) : current.length >= MAX_PICKS ? current : [...current, key]);
  const save = () => {
    const items = { ...(override.items || {}) };
    // Earlier picks are cleared; names and other per-item settings stay.
    for (const key of Object.keys(items)) items[key] = Object.fromEntries(Object.entries(items[key]).filter(([field]) => field !== "featured" && field !== "order"));
    picks.forEach((key, index) => { items[key] = { ...(items[key] || {}), featured: true, order: index }; });
    onSave({ ...override, items });
  };
  const byKey = new Map(arrival.items.map((item) => [item.key, item]));
  const kind = override.kind || arrival.odooKind;
  const date = override.date || arrival.odooDate;
  const title = (override.title?.ko || copy[kind]?.title?.ko || KINDS.find(([id]) => id === kind)[2]).replace(/\{date\}/g, date ? new Date(`${date}T00:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "");
  const linkedItems = arrival.items.filter((item) => item.linked);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h2" variant="headingSm">미리보기 상품</Text>
            <Text as="p" tone="subdued" variant="bodySm">{arrival.ref} · 앱 홈 입고 카드에 보일 상품, 최대 {MAX_PICKS}개 (선택 순서대로 표시)</Text>
          </BlockStack>
          <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>{dirty ? "미리보기 저장" : "저장됨"}</Button>
        </InlineStack>

        <Box padding="300" background="bg-surface-secondary" borderRadius="300">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">{KIND_LABEL[kind]}</Text>
            <Text as="p" variant="headingSm">{title}</Text>
            <InlineStack gap="150" blockAlign="center">
              {(picks.length ? picks.map((key) => byKey.get(key)).filter(Boolean) : linkedItems.slice(0, 4)).map((item) => (
                <Thumbnail key={item.key} size="small" source={item.image || BLANK} alt={item.name} />
              ))}
              <Text as="span" variant="bodySm" tone="critical">입고 상품 보기 ›</Text>
            </InlineStack>
            {!picks.length && <Text as="p" variant="bodySm" tone="subdued">아직 고르지 않아 앞의 4개가 보입니다.</Text>}
          </BlockStack>
        </Box>

        <Text as="p" fontWeight="semibold">{picks.length}/{MAX_PICKS}개 선택</Text>
        <BlockStack gap="100">
          {arrival.items.map((item) => {
            const index = picks.indexOf(item.key);
            const full = index < 0 && picks.length >= MAX_PICKS;
            return (
              <ItemLine key={item.key} item={item} prefix={
                <InlineStack gap="100" blockAlign="center" wrap={false}>
                  <Checkbox label={`${item.name} 미리보기에 표시`} labelHidden checked={index >= 0} disabled={!item.linked || full} onChange={() => toggle(item.key)} />
                  <div style={{ width: 22 }}>{index >= 0 && <Badge tone="info">{String(index + 1)}</Badge>}</div>
                </InlineStack>
              } />
            );
          })}
        </BlockStack>
        <Text as="p" tone="subdued" variant="bodySm">쇼핑몰 미연결 상품은 고를 수 없습니다. Odoo와 쇼핑몰의 SKU, 바코드, 상품명 중 하나가 같아야 연결됩니다.</Text>
      </BlockStack>
    </Card>
  );
}

// Optional: the chosen arrival's date, kind, display window, title and note.
function DetailsCard({ arrival, override, copy, saving, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(override);
  useEffect(() => setDraft(override), [override]);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const kind = draft.kind || arrival.odooKind;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h2" variant="headingSm">상세 설정</Text>
            <Text as="p" tone="subdued" variant="bodySm">날짜, 종류, 표시 기간, 이 입고만의 제목과 안내 문구</Text>
          </BlockStack>
          <Button onClick={() => setOpen(!open)}>{open ? "닫기" : "열기"}</Button>
        </InlineStack>
        {open && (
          <BlockStack gap="300">
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
              <TextField label="앱에 보일 날짜" type="date" value={draft.date || ""} autoComplete="off" onChange={(value) => set({ date: value || undefined })}
                helpText={`비우면 Odoo 예정일(${arrival.odooDate || "미정"})을 씁니다. 카운트다운도 이 날짜 기준입니다.`} />
              <Select label="종류" value={draft.kind || ""} onChange={(value) => set({ kind: value || undefined })}
                options={[{ label: `Odoo 기준 (${KIND_LABEL[arrival.odooKind]})`, value: "" }, { label: "한국 컨테이너", value: "container" }, { label: "독일 내 입고", value: "domestic" }]} />
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
              <TextField label="표시 시작일" type="date" value={draft.showFrom || ""} autoComplete="off" onChange={(value) => set({ showFrom: value || undefined })} helpText="이 날부터 앱에 보입니다. 비우면 바로 표시." />
              <TextField label="표시 종료일" type="date" value={draft.showUntil || ""} autoComplete="off" onChange={(value) => set({ showUntil: value || undefined })} helpText="이 날까지 보입니다. 비우면 입고가 끝날 때까지." />
            </InlineGrid>
            <Divider />
            <LangFields label="이 입고의 제목" value={draft.title} maxLength={120} placeholder={copy[kind]?.title?.ko || KINDS.find(([id]) => id === kind)[2]} onChange={(title) => set({ title })} />
            <Text as="p" tone="subdued" variant="bodySm">{"{date}"} 자리에 날짜가 들어갑니다. 비우면 아래 기본 문구를 씁니다.</Text>
            <LangFields label="안내 문구" value={draft.note} maxLength={300} multiline={2} placeholder="예: 이번 컨테이너는 냉동식품이 많아요!" onChange={(note) => set({ note })} />
            <InlineStack align="end"><Button variant="primary" loading={saving} onClick={() => onSave(draft)}>상세 설정 저장</Button></InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export default function ArrivalsPage() {
  const data = useLoaderData();
  const chooser = useFetcher(), arrivalSaver = useFetcher(), syncer = useFetcher(), copySaver = useFetcher(), skuAssigner = useFetcher();
  const result = chooser.data || arrivalSaver.data || syncer.data || copySaver.data || skuAssigner.data;
  const [pending, setPending] = useState(undefined); // arrival to confirm, null = turn off

  // Before anything is chosen, the app shows every arrival (the nearest on the home card).
  const chosenRef = data.selection ? data.containers.find((c) => data.selection.shown.includes(c.ref))?.ref || null : null;
  const chosen = data.containers.find((c) => c.ref === chosenRef) || null;
  const activeForSku = chosen || pending || data.containers[0] || null;
  const missingSkuItems = useMemo(
    () => (activeForSku ? activeForSku.items.filter((it) => !it.sku) : []),
    [activeForSku]
  );
  const allActiveSkus = useMemo(
    () => (activeForSku ? activeForSku.items.map((it) => it.sku).filter(Boolean) : []),
    [activeForSku]
  );
  const lostRef = data.selection?.shown.find((ref) => !data.containers.some((c) => c.ref === ref));
  const reviewed = new Set(data.selection ? data.selection.reviewed : data.containers.map((c) => c.ref));
  const overrideOf = (ref) => data.overrides[ref] || {};
  const confirm = () => {
    chooser.submit({ intent: "choose", ref: pending ? pending.ref : "", reviewed: JSON.stringify(data.containers.map((c) => c.ref)) }, { method: "post" });
    setPending(undefined);
  };
  const saveArrival = (what) => (override) => arrivalSaver.submit({ intent: "arrival", what, ref: chosen.ref, override: JSON.stringify(override) }, { method: "post" });

  const [copy, setCopy] = useState(data.copy);
  useEffect(() => setCopy(data.copy), [data.copy]);
  const setCopyField = (kind, field, value) => setCopy((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));

  return (
    <Page title="앱 입고 일정" subtitle="Odoo 입고 중 앱 홈에 보여줄 입고를 고릅니다."
      secondaryActions={[{ content: "Odoo에서 지금 가져오기", loading: syncer.state !== "idle", onAction: () => syncer.submit({ intent: "sync" }, { method: "post" }) }]}>
      <BlockStack gap="400">
        {result && <Banner tone={result.ok ? "success" : "critical"}>{result.message}</Banner>}
        {lostRef && !chosen && <Banner tone="warning">설정했던 입고 {lostRef}가 입고 완료되어 목록에서 빠졌습니다. 앱 홈에 입고 카드가 보이지 않으니 다음 입고를 골라주세요.</Banner>}
        {!data.selection && data.containers.length > 0 && <Banner tone="info">선택한 입고가 없어 가장 가까운 입고가 앱에 표시되고 있습니다.</Banner>}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">입고 목록</Text>
              <Text as="span" tone="subdued" variant="bodySm">마지막 동기화 {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"} · 매시 자동</Text>
            </InlineStack>
          </Box>
          {data.containers.length === 0
            ? <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">Odoo에 열린 입고가 없습니다.</Text></Box>
            : <ArrivalTable arrivals={data.containers} chosenRef={chosenRef} overrideOf={overrideOf} onChoose={setPending}
                isNew={(ref) => Boolean(data.selection) && !reviewed.has(ref)} />}
        </Card>

        {activeForSku && missingSkuItems.length > 0 && (
          <MissingSkuManagerCard
            containerRef={activeForSku.ref}
            missingItems={missingSkuItems}
            allContainerSkus={allActiveSkus}
            nextSkuByPrefix={data.nextSkuByPrefix || {}}
            applying={skuAssigner.state !== "idle"}
            resultBanner={skuAssigner.data || null}
            onApplySkus={({ assignments, createInShopifyIfMissing, autoResolveCollision }) => {
              skuAssigner.submit(
                {
                  intent: "assign_skus",
                  containerRef: activeForSku.ref,
                  createInShopifyIfMissing: String(Boolean(createInShopifyIfMissing)),
                  autoResolveCollision: String(autoResolveCollision !== false),
                  assignments: JSON.stringify(assignments),
                },
                { method: "post" }
              );
            }}
          />
        )}

        {chosen && <PicksCard arrival={chosen} override={overrideOf(chosen.ref)} copy={copy} saving={arrivalSaver.state !== "idle" && arrivalSaver.formData?.get("what") === "picks"} onSave={saveArrival("picks")} />}
        {chosen && <DetailsCard arrival={chosen} override={overrideOf(chosen.ref)} copy={copy} saving={arrivalSaver.state !== "idle" && arrivalSaver.formData?.get("what") === "details"} onSave={saveArrival("details")} />}

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="050">
              <Text as="h2" variant="headingSm">기본 문구</Text>
              <Text as="p" tone="subdued" variant="bodySm">입고별 제목이 없을 때 쓰입니다. {"{date}"}는 입고 날짜로 바뀝니다.</Text>
            </BlockStack>
            {KINDS.map(([kind, name, titleHint, labelHint]) => (
              <BlockStack key={kind} gap="200">
                <Text as="h3" variant="headingSm">{name}</Text>
                <LangFields label="제목" value={copy[kind].title} placeholder={titleHint} maxLength={120} onChange={(value) => setCopyField(kind, "title", value)} />
                <LangFields label="목록 표시 이름" value={copy[kind].label} placeholder={labelHint} maxLength={120} onChange={(value) => setCopyField(kind, "label", value)} />
              </BlockStack>
            ))}
            <InlineStack align="end">
              <Button loading={copySaver.state !== "idle"} onClick={() => copySaver.submit({ intent: "copy", copy: JSON.stringify(copy) }, { method: "post" })}>기본 문구 저장</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal size="large" open={pending !== undefined} onClose={() => setPending(undefined)} title={pending ? "입고 설정 확인" : "입고 표시 끄기"}
        primaryAction={{ content: pending ? "설정" : "끄기", destructive: !pending, onAction: confirm, loading: chooser.state !== "idle" }}
        secondaryActions={[{ content: "취소", onAction: () => setPending(undefined) }]}>
        <Modal.Section>
          {pending ? (
            <BlockStack gap="200">
              <Text as="p"><strong>{pending.ref}</strong> ({formatDate(overrideOf(pending.ref).date || pending.odooDate)}, {KIND_LABEL[overrideOf(pending.ref).kind || pending.odooKind]}) 입고로 설정하시겠습니까?</Text>
              <Text as="p" tone="subdued">앱 홈 입고 카드와 입고 상품 목록에 이 입고만 보입니다.{chosen ? ` 지금 표시 중인 ${chosen.ref}는 앱에서 내려갑니다.` : ""}</Text>
              <Divider />
              <Text as="p" fontWeight="semibold">들어오는 상품 총 {pending.itemCount}개 · 쇼핑몰 연결 {pending.items.filter((item) => item.linked).length}개</Text>
              <BlockStack gap="100">
                {pending.items.map((item) => <ItemLine key={item.key} item={item} showSku />)}
              </BlockStack>
              {pending.itemCount > pending.items.length && <Text as="p" tone="subdued" variant="bodySm">처음 {pending.items.length}개만 보여줍니다.</Text>}
            </BlockStack>
          ) : (
            <Text as="p">앱 홈에서 입고 카드를 내리시겠습니까? 다시 고를 때까지 앱에 입고 일정이 보이지 않습니다.</Text>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
