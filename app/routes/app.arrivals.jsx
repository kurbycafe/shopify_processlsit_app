import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { Badge, Banner, BlockStack, Box, Button, Card, Checkbox, Divider, InlineGrid, InlineStack, Page, Select, Text, TextField } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveCanonicalShop, parseExtendedSettings } from "../services/mobileStorefront.server.js";
import { saveStorefrontConfig } from "../services/productTemperatures.server.js";
import { getShopAliases } from "../services/subscriptionService.server.js";
import { arrivalItemCode, resolveArrivalSkus } from "../services/customerResources.server.js";
import { getOdooRpc } from "../services/odooClient.server.js";
import { syncOdooArrivals } from "../services/arrivalsSync.server.js";
import { normalizeArrivalCopy, normalizeArrivalSelection, normalizeArrivalOverrides, arrivalItemKey } from "../utils/arrivalCopy.js";

// Everything about the app's arrival board in one place: the synced Odoo
// receipts, which of them (and which items) the app shows, per-arrival details
// (date, kind, title, note, display window, item order and names), the default
// wording, and a manual sync.
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [config, containers] = await Promise.all([
    prisma.mobileStorefrontConfig.findUnique({ where: { shop } }),
    prisma.container.findMany({
      where: { shop: { in: getShopAliases(session.shop) }, status: { in: ["SCHEDULED", "IN_TRANSIT"] }, scheduledDate: { gte: since } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }], take: 25,
      select: { id: true, containerRef: true, supplier: true, status: true, arrivalKind: true, scheduledDate: true, syncedAt: true,
        items: { orderBy: { id: "asc" }, take: 100, select: { sku: true, barcode: true, productName: true, expectedQty: true } } },
    }),
  ]);
  const graphql = (_shop, query, variables) => admin.graphql(query, { variables }).then((response) => response.json());
  const links = await resolveArrivalSkus({ graphql, shop: session.shop, codes: containers.flatMap((c) => c.items.map(arrivalItemCode)) });
  const settings = parseExtendedSettings(config?.tickersJson);
  return {
    copy: normalizeArrivalCopy(settings.arrivalCopy),
    selection: normalizeArrivalSelection(settings.arrivalSelection),
    overrides: normalizeArrivalOverrides(settings.arrivalOverrides),
    lastSyncedAt: containers.reduce((latest, c) => (!latest || c.syncedAt > latest ? c.syncedAt : latest), null),
    containers: containers.map((c) => ({
      id: c.id, ref: c.containerRef, supplier: c.supplier, status: c.status, odooDate: c.scheduledDate,
      odooKind: c.arrivalKind === "DOMESTIC" ? "domestic" : "container",
      items: c.items.map((item) => ({ key: arrivalItemKey(c.containerRef, item), name: item.productName, sku: item.sku, qty: item.expectedQty, linked: Boolean(links.get(arrivalItemCode(item))) })),
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
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
  try {
    let tickersJson, message;
    if (intent === "settings") {
      const arrivalSelection = normalizeArrivalSelection(JSON.parse(String(form.get("selection") || "{}")));
      if (!arrivalSelection) throw new Error("invalid");
      const arrivalOverrides = normalizeArrivalOverrides(JSON.parse(String(form.get("overrides") || "{}")));
      tickersJson = { arrivalSelection, arrivalOverrides };
      message = `저장했습니다. 앱에 표시하는 입고 ${arrivalSelection.shown.length}건이 앱을 다시 열면 반영됩니다.`;
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

function ItemRow({ item, shown, setting, onToggle, onSetting, disabled }) {
  const [naming, setNaming] = useState(Boolean(setting.name));
  return (
    <Box paddingBlock="150" borderBlockEndWidth="025" borderColor="border-secondary">
      <BlockStack gap="150">
        <InlineStack gap="300" blockAlign="center" wrap>
          <Checkbox label="표시" checked={shown} disabled={disabled} onChange={onToggle} />
          <Checkbox label="추천" checked={Boolean(setting.featured)} disabled={disabled || !shown} onChange={(value) => onSetting({ featured: value || undefined })} />
          <div style={{ width: 90 }}>
            <TextField label="순서" labelHidden type="number" min={0} max={999} placeholder="순서" value={setting.order === undefined ? "" : String(setting.order)} disabled={disabled || !shown} autoComplete="off"
              onChange={(value) => onSetting({ order: value === "" ? undefined : Math.max(0, Math.min(999, Math.round(Number(value) || 0))) })} />
          </div>
          <Badge tone={item.linked ? "success" : undefined}>{item.linked ? "상품 연결됨" : "미연결"}</Badge>
          <Text as="span" fontWeight={setting.featured ? "semibold" : "regular"}>{setting.name?.ko || item.name}</Text>
          <Text as="span" tone="subdued" variant="bodySm">{item.sku ? `SKU ${item.sku} · ` : ""}{item.qty}개</Text>
          <Button variant="plain" disabled={disabled || !shown} onClick={() => setNaming(!naming)}>{naming ? "이름 닫기" : "앱 이름 바꾸기"}</Button>
        </InlineStack>
        {naming && shown && <LangFields label="앱에 보일 이름" value={setting.name} placeholder={item.name} maxLength={200} onChange={(name) => onSetting({ name })} />}
      </BlockStack>
    </Box>
  );
}

function ArrivalCard({ arrival, shown, isNew, hiddenItems, override, copy, onToggle, onToggleItem, onOverride }) {
  const [details, setDetails] = useState(false), [itemsOpen, setItemsOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const date = override.date || arrival.odooDate;
  const kind = override.kind || arrival.odooKind;
  const visibleItems = arrival.items.filter((item) => !hiddenItems.has(item.key));
  const linked = visibleItems.filter((item) => item.linked).length;
  const waiting = override.showFrom && today < override.showFrom, ended = override.showUntil && today > override.showUntil;
  const itemSetting = (key) => override.items?.[key] || {};
  const setItem = (key, patch) => onOverride({ items: { ...(override.items || {}), [key]: { ...itemSetting(key), ...patch } } });
  const kindDefault = KINDS.find(([id]) => id === kind);

  return (
    <Box padding="300" borderWidth="025" borderColor={shown ? "border-emphasis" : "border"} borderRadius="300" background={shown ? "bg-surface" : "bg-surface-secondary"}>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Checkbox label="앱에 표시" labelHidden checked={shown} onChange={onToggle} />
            <Text as="h3" variant="headingSm">{formatDate(date)}</Text>
            {override.date && <Badge>날짜 직접 지정</Badge>}
            <Badge tone={kind === "container" ? "critical" : "info"}>{KIND_LABEL[kind]}</Badge>
            {isNew && <Badge tone="attention">새 일정</Badge>}
            {waiting && <Badge tone="info">{`${override.showFrom}부터 표시`}</Badge>}
            {ended && <Badge>표시 기간 끝남</Badge>}
            {date && date < today && <Badge tone="warning">예정일 지남 · 앱에 &ldquo;곧 들어와요&rdquo;로 표시</Badge>}
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">{arrival.ref}{arrival.supplier ? ` · ${arrival.supplier}` : ""}</Text>
        </InlineStack>
        <Text as="p" tone={shown ? undefined : "subdued"}>
          {shown
            ? <>앱에 표시 중 · 품목 {visibleItems.length}개 중 <strong>{linked}개</strong>가 쇼핑몰 상품과 연결되어 보입니다.{linked === 0 && " 연결된 상품이 없어 앱 홈에는 나타나지 않습니다."}</>
            : "앱에 표시하지 않음"}
        </Text>
        {shown && (override.title?.ko || override.note?.ko) && (
          <Text as="p" tone="subdued" variant="bodySm">앱 제목: {override.title?.ko || "(기본 문구)"}{override.note?.ko ? ` · 안내: ${override.note.ko}` : ""}</Text>
        )}
        <InlineStack gap="300">
          <Button variant="plain" disabled={!shown} onClick={() => setDetails(!details)}>{details ? "상세 설정 닫기" : "상세 설정"}</Button>
          <Button variant="plain" onClick={() => setItemsOpen(!itemsOpen)}>{itemsOpen ? "품목 접기" : `품목 (${arrival.items.length})`}</Button>
        </InlineStack>

        {details && shown && (
          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="300">
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                <TextField label="앱에 보일 날짜" type="date" value={override.date || ""} autoComplete="off" onChange={(value) => onOverride({ date: value || undefined })}
                  helpText={`비우면 Odoo 예정일(${arrival.odooDate || "미정"})을 씁니다. 카운트다운도 이 날짜 기준입니다.`} />
                <Select label="종류" value={override.kind || ""} onChange={(value) => onOverride({ kind: value || undefined })}
                  options={[{ label: `Odoo 기준 (${KIND_LABEL[arrival.odooKind]})`, value: "" }, { label: "한국 컨테이너", value: "container" }, { label: "독일 내 입고", value: "domestic" }]} />
              </InlineGrid>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                <TextField label="표시 시작일" type="date" value={override.showFrom || ""} autoComplete="off" onChange={(value) => onOverride({ showFrom: value || undefined })} helpText="이 날부터 앱에 보입니다. 비우면 바로 표시." />
                <TextField label="표시 종료일" type="date" value={override.showUntil || ""} autoComplete="off" onChange={(value) => onOverride({ showUntil: value || undefined })} helpText="이 날까지 보입니다. 비우면 Odoo에서 입고가 끝날 때까지." />
              </InlineGrid>
              <Divider />
              <LangFields label="이 일정의 제목" value={override.title} maxLength={120} placeholder={copy[kind]?.title?.ko || kindDefault?.[2]} onChange={(title) => onOverride({ title })} />
              <Text as="p" tone="subdued" variant="bodySm">{"{date}"} 자리에 날짜가 들어갑니다. 비우면 페이지 아래 기본 문구를 씁니다.</Text>
              <LangFields label="안내 문구" value={override.note} maxLength={300} multiline={2} placeholder="예: 이번 컨테이너는 냉동식품이 많아요!" onChange={(note) => onOverride({ note })} />
              <Text as="p" tone="subdued" variant="bodySm">앱 입고 카드 제목 아래와 입고 일정 화면에 보입니다.</Text>
            </BlockStack>
          </Box>
        )}

        {itemsOpen && (
          <BlockStack gap="0">
            {arrival.items.map((item) => (
              <ItemRow key={item.key} item={item} shown={!hiddenItems.has(item.key)} setting={itemSetting(item.key)} disabled={!shown}
                onToggle={() => onToggleItem(item.key)} onSetting={(patch) => setItem(item.key, patch)} />
            ))}
            <Box paddingBlockStart="200">
              <Text as="p" tone="subdued" variant="bodySm">추천 품목은 맨 앞에 강조되어 보이고, 나머지는 순서 숫자가 작은 것부터 보입니다. 미연결 품목은 Odoo와 쇼핑몰의 SKU·바코드·상품명 중 하나를 같게 맞추면 앱에 보입니다.</Text>
            </Box>
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}

export default function ArrivalsPage() {
  const data = useLoaderData();
  const saver = useFetcher(), syncer = useFetcher(), copySaver = useFetcher();
  const result = saver.data || syncer.data || copySaver.data;

  // Until a selection is saved, every synced arrival is shown in the app.
  const initial = useMemo(() => ({
    shown: new Set(data.selection ? data.selection.shown : data.containers.map((c) => c.ref)),
    hiddenItems: new Set(data.selection ? data.selection.hiddenItems : []),
    overrides: data.overrides,
  }), [data.selection, data.containers, data.overrides]);
  const [state, setState] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setState(initial); setDirty(false); }, [initial]);
  const reviewed = new Set(data.selection ? data.selection.reviewed : data.containers.map((c) => c.ref));
  const update = (fn) => { setState((current) => fn(current)); setDirty(true); };
  const toggle = (key, field) => update((current) => {
    const next = new Set(current[field]);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...current, [field]: next };
  });
  const setOverride = (ref, patch) => update((current) => ({ ...current, overrides: { ...current.overrides, [ref]: { ...(current.overrides[ref] || {}), ...patch } } }));
  const save = () => saver.submit({
    intent: "settings",
    selection: JSON.stringify({ shown: [...state.shown], hiddenItems: [...state.hiddenItems], reviewed: [...new Set([...reviewed, ...data.containers.map((c) => c.ref)])] }),
    overrides: JSON.stringify(state.overrides),
  }, { method: "post" });

  const [copy, setCopy] = useState(data.copy);
  useEffect(() => setCopy(data.copy), [data.copy]);
  const setCopyField = (kind, field, value) => setCopy((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));

  return (
    <Page title="앱 입고 일정" subtitle="Odoo 입고 목록에서 앱에 보일 일정을 고르고, 일정·품목별로 자세히 설정합니다."
      primaryAction={{ content: dirty ? "변경 사항 저장" : "저장됨", disabled: !dirty || !data.containers.length, loading: saver.state !== "idle", onAction: save }}
      secondaryActions={[{ content: "Odoo에서 지금 가져오기", loading: syncer.state !== "idle", onAction: () => syncer.submit({ intent: "sync" }, { method: "post" }) }]}>
      <BlockStack gap="400">
        {result && <Banner tone={result.ok ? "success" : "critical"}>{result.message}</Banner>}
        {dirty && <Banner tone="warning">저장하지 않은 변경 사항이 있습니다. 오른쪽 위 &ldquo;변경 사항 저장&rdquo;을 눌러야 앱에 반영됩니다.</Banner>}
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">입고 리스트</Text>
              <Text as="p" tone="subdued" variant="bodySm">마지막 동기화: {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString("ko-KR") : "기록 없음"} · 매시 7분 자동 동기화 · 체크한 일정만 앱에 보입니다.</Text>
            </BlockStack>
            {data.containers.length === 0
              ? <Text as="p" tone="subdued">예정된 입고가 없습니다. 앱 홈에는 입고 카드가 나타나지 않습니다.</Text>
              : data.containers.map((arrival) => (
                  <ArrivalCard key={arrival.id} arrival={arrival} copy={copy} shown={state.shown.has(arrival.ref)} isNew={Boolean(data.selection) && !reviewed.has(arrival.ref)}
                    hiddenItems={state.hiddenItems} override={state.overrides[arrival.ref] || {}}
                    onToggle={() => toggle(arrival.ref, "shown")} onToggleItem={(key) => toggle(key, "hiddenItems")} onOverride={(patch) => setOverride(arrival.ref, patch)} />
                ))}
            {!data.selection && data.containers.length > 0 && <Text as="p" tone="subdued" variant="bodySm">아직 저장한 적이 없어 모든 일정이 앱에 보입니다. 한 번 저장하면 그때부터 체크한 일정만 나오고, 새로 들어오는 일정은 &ldquo;새 일정&rdquo;으로 표시되어 직접 고를 수 있습니다.</Text>}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">기본 문구</Text>
              <Text as="p" tone="subdued" variant="bodySm">일정별 제목을 따로 쓰지 않은 일정에 쓰입니다. {"{date}"} 자리에 입고 날짜가 들어가고, 비워두면 회색 예시 문구가 쓰입니다.</Text>
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
    </Page>
  );
}
