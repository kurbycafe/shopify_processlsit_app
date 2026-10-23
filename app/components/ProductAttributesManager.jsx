import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import { ATTRIBUTE_FIELDS, ATTRIBUTE_DEFAULTS } from "../utils/productAttributes.js";
import { TEMPERATURE_LABELS } from "../utils/productTemperatures.js";

const ENDPOINT = "/app/product-attributes";
const PAGE_SIZE = 50;
const FILTERS = [
 { label: "전체 상품", value: "all" }, { label: "속성 미설정", value: "unset" },
 { label: "MHD 임박특가", value: "mhd" },
 { label: "무료배송 채우기 추천", value: "filler" }, { label: "오픈예정", value: "upcoming" },
 { label: "연령 제한", value: "age" }, { label: "보증금 있음", value: "pfand" },
];
async function resultJson(response) {
 let result;
 try { result = await response.json(); } catch { throw new Error("서버 응답을 확인하지 못했습니다. 목록을 새로고침해주세요."); }
 if (!response.ok || result.success !== true) throw new Error(result.message || "상품 속성을 처리하지 못했습니다.");
 return result;
}
function attributeBadges(item) {
 const a = item.attributes;
 return <InlineStack gap="100">
  {a.isMhdDeal && <Badge tone="critical">MHD 특가 표시</Badge>}
  {a.isCartFiller && <Badge tone="success">무료배송 채우기</Badge>}
  {a.isUpcomingDeal && <Badge tone="info">{"오픈예정" + (a.upcomingDateKo ? " · " + a.upcomingDateKo : "")}</Badge>}
  {a.ageRestriction && <Badge tone="attention">{a.ageRestriction}</Badge>}
  {Number(a.pfand) > 0 && <Badge>{"Pfand €" + Number(a.pfand).toFixed(2)}</Badge>}
  {a.bundleBadgeKo && <Badge>{a.bundleBadgeKo}</Badge>}
  {!item.hasAttributes && "—"}
 </InlineStack>;
}
export default function ProductAttributesManager({ onSaved } = {}) {
 const [items, setItems] = useState([]);
 const [loadStatus, setLoadStatus] = useState("loading");
 const [error, setError] = useState("");
 const [success, setSuccess] = useState("");
 const [reloadKey, setReloadKey] = useState(0);
 const [query, setQuery] = useState("");
 const [filter, setFilter] = useState("all");
 const [page, setPage] = useState(1);
 const [selected, setSelected] = useState([]);
 const [editing, setEditing] = useState(false);
 const [draft, setDraft] = useState({ ...ATTRIBUTE_DEFAULTS });
 const [applied, setApplied] = useState({});
 const [saving, setSaving] = useState(false);
 const [progress, setProgress] = useState(null);
 const savingRef = useRef(false);
 const controllerRef = useRef(null);
 const editorRef = useRef(null);
 useEffect(() => {
  const controller = new AbortController();
  let current = true;
  setItems([]); setSelected([]); setEditing(false); setError(""); setSuccess(""); setLoadStatus("loading"); setPage(1);
  void (async () => {
   const rows = new Map(), cursors = new Set();
   let after = null;
   try {
    do {
     const data = await resultJson(await fetch(ENDPOINT + (after ? "?after=" + encodeURIComponent(after) : ""), { signal: controller.signal, cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }));
     if (!Array.isArray(data.items) || typeof data.pageInfo?.hasNextPage !== "boolean") throw new Error("상품 목록 응답이 올바르지 않습니다.");
     for (const item of data.items) {
      if (!item.id || typeof item.title !== "string" || !item.attributes) throw new Error("상품 속성 응답이 올바르지 않습니다.");
      rows.set(item.id, item);
     }
     if (!current) return;
     setItems([...rows.values()]);
     if (!data.pageInfo.hasNextPage) break;
     const next = data.pageInfo.endCursor;
     if (!next || cursors.has(next)) throw new Error("다음 상품 페이지를 확인하지 못했습니다.");
     cursors.add(next); after = next;
    } while (current);
    if (current) setLoadStatus("ready");
   } catch (err) { if (current && err.name !== "AbortError") { setError(err.message); setLoadStatus("error"); } }
  })();
  return () => { current = false; controller.abort(); };
 }, [reloadKey]);
 useEffect(() => () => controllerRef.current?.abort(), []);
 const deferredQuery = useDeferredValue(query);
 const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
 const filtered = useMemo(() => {
  const term = deferredQuery.trim().toLowerCase();
  return items.filter(item => {
   if (term && ![item.title, item.sku, item.id].some(value => String(value).toLowerCase().includes(term))) return false;
   const a = item.attributes;
   if (filter === "unset") return !item.hasAttributes;
   if (filter === "mhd") return Boolean(a.isMhdDeal || a.mhdDate);
   if (filter === "expired") return Boolean(a.mhdDate && a.mhdDate < today);
   if (filter === "filler") return a.isCartFiller;
   if (filter === "upcoming") return a.isUpcomingDeal;
   if (filter === "age") return Boolean(a.ageRestriction);
   if (filter === "pfand") return Number(a.pfand) > 0;
   return true;
  });
 }, [items, deferredQuery, filter, today]);
 const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
 const currentPage = Math.min(page, pageCount);
 const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
 const checkedCount = visible.filter(item => selected.includes(item.id)).length;
 const busy = saving || loadStatus !== "ready";
 const patch = Object.fromEntries(Object.entries(applied).filter(([, enabled]) => enabled).map(([key]) => [key, draft[key]]));
 const reset = () => { setSelected([]); setEditing(false); setApplied({}); setError(""); setSuccess(""); };
 const openEditor = item => {
  if (item) setSelected([item.id]);
  setDraft(item ? { ...ATTRIBUTE_DEFAULTS, ...item.attributes } : { ...ATTRIBUTE_DEFAULTS });
  setApplied({}); setEditing(true); setError(""); setSuccess("");
  requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
 };
 const save = async () => {
  if (savingRef.current || busy || !selected.length || !Object.keys(patch).length) return;
  const ids = [...selected], confirmed = new Set();
  const controller = new AbortController(); controllerRef.current = controller;
  savingRef.current = true; setSaving(true); setError(""); setSuccess(""); setProgress({ completed: 0, total: ids.length });
  try {
   for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const data = await resultJson(await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", signal: controller.signal,
     headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ productIds: batch, patch }) }));
    if (data.updatedCount !== batch.length || !data.saveId || !Array.isArray(data.items) ||
        data.items.length !== batch.length || batch.some(id => !data.items.some(item => item.id === id && item.attributes))) throw new Error("저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.");
    const changed = new Map(data.items.map(item => [item.id, item]));
    for (const id of batch) confirmed.add(id);
    setItems(previous => previous.map(item => changed.get(item.id) || item));
    setSelected(previous => previous.filter(id => !confirmed.has(id)));
    setProgress({ completed: confirmed.size, total: ids.length });
   }
   setSuccess(confirmed.size + "개 상품의 선택한 속성을 저장했습니다."); setEditing(false); setApplied({}); onSaved?.();
  } catch (err) {
   if (err.name !== "AbortError") setError((confirmed.size ? confirmed.size + "개 저장 완료. 남은 " + (ids.length - confirmed.size) + "개는 선택 상태를 유지합니다. " : "") + err.message + " 저장 여부가 불확실하면 목록을 새로고침하여 확인해주세요.");
  } finally {
   savingRef.current = false;
   if (!controller.signal.aborted) { setSaving(false); setProgress(null); }
  }
 };
 return <BlockStack gap="400">
  <Card><BlockStack gap="300">
   <InlineStack align="space-between" gap="200">
    <BlockStack gap="100"><Text as="h2" variant="headingMd">추천 · 상품 속성 관리</Text><Text as="p" tone="subdued">실제 상품의 특가 표시·추천·오픈예정·연령 제한·보증금을 관리합니다. 실제 날짜는 유통기한 관리에서 수정합니다.</Text></BlockStack>
    <Button disabled={saving} loading={loadStatus === "loading"} onClick={() => setReloadKey(value => value + 1)}>속성 목록 새로고침</Button>
   </InlineStack>
   <InlineStack gap="200"><Badge>{"조회 상품 " + items.length + "개"}</Badge><Badge>{"속성 미설정 " + items.filter(item => !item.hasAttributes).length + "개"}</Badge></InlineStack>
   {loadStatus === "loading" && <p role="status">전체 상품을 조회하고 있습니다. 완료 후 편집할 수 있습니다.</p>}
   {loadStatus === "error" && <Banner tone="critical"><p>상품 조회가 완료되지 않았습니다. 현재 목록은 일부 상품일 수 있습니다.</p></Banner>}
   <InlineStack gap="300" align="start">
    <div style={{ flex: 2, minWidth: 220 }}><TextField label="속성 상품 검색" value={query} disabled={saving} onChange={value => { setQuery(value); setPage(1); reset(); }} autoComplete="off" placeholder="상품 이름 · SKU · Product ID" clearButton onClearButtonClick={() => { setQuery(""); setPage(1); reset(); }} /></div>
    <div style={{ flex: 1, minWidth: 180 }}><Select label="상품 속성 필터" value={filter} options={FILTERS} disabled={saving} onChange={value => { setFilter(value); setPage(1); reset(); }} /></div>
   </InlineStack>
   <Text as="p" tone="subdued">온도는 custom.producttype 기준으로 표시하며 온도 관리에서 수정합니다. 판매가격·재고는 이 화면에서 변경하지 않습니다.</Text>
  </BlockStack></Card>
  {error && <Banner tone="critical"><p>{error}</p></Banner>}
  {success && <Banner tone="success"><p role="status">{success}</p></Banner>}
  <Card><BlockStack gap="300">
   <InlineStack align="space-between" gap="200" blockAlign="center">
    <Text as="h3" variant="headingSm">{selected.length + "개 상품 선택됨"}</Text>
    <InlineStack gap="200">
     <Button disabled={busy || !filtered.length} onClick={() => { setSelected(filtered.map(item => item.id)); setError(""); setSuccess(""); }}>{"검색 결과 전체 " + filtered.length + "개 선택"}</Button>
     <Button disabled={busy || !selected.length} onClick={reset}>선택 해제</Button>
     <Button variant="primary" disabled={busy || !selected.length} onClick={() => openEditor()}>선택 상품 속성 수정</Button>
    </InlineStack>
   </InlineStack>
   {progress && <p role="status">{"속성 저장 중 " + progress.completed + " / " + progress.total + "개"}</p>}
   {editing && <div ref={editorRef} style={{ padding: 16, border: "1px solid #c9cccf", borderRadius: 8, background: "#f7f8fa", scrollMarginTop: 20 }}>
    <BlockStack gap="300">
     <Text as="h3" variant="headingMd">선택 상품 일괄 편집</Text>
     <Text as="p">변경할 항목만 체크하세요. 체크하지 않은 항목은 각 상품의 기존 값을 유지합니다. 체크한 텍스트를 비우면 기존 문구를 삭제합니다.</Text>
     <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
      {Object.entries(ATTRIBUTE_FIELDS).filter(([key]) => !["mhdDate", "mhdPrice"].includes(key)).map(([key, field]) => <BlockStack key={key} gap="100">
       <Checkbox label={field.label + " 변경"} checked={Boolean(applied[key])} disabled={busy} onChange={value => setApplied(previous => ({ ...previous, [key]: value }))} />
       {field.type === "boolean" ? <Select label={field.label} labelHidden disabled={busy || !applied[key]} value={draft[key] ? "true" : "false"} options={[{ label: "사용", value: "true" }, { label: "해제", value: "false" }]} onChange={value => setDraft(previous => ({ ...previous, [key]: value === "true" }))} /> :
        field.type === "age" ? <Select label={field.label} labelHidden disabled={busy || !applied[key]} value={draft[key]} options={[{ label: "기본값 (별도 지정 없음)", value: "" }, { label: "16세 이상", value: "16+" }, { label: "18세 이상", value: "18+" }]} onChange={value => setDraft(previous => ({ ...previous, [key]: value }))} /> :
        <TextField label={field.label} labelHidden disabled={busy || !applied[key]} value={String(draft[key] ?? "")} type={field.type === "date" ? "date" : field.type === "price" || field.type === "money" ? "number" : "text"} autoComplete="off" min={field.type === "price" ? 0.01 : field.type === "money" ? 0 : undefined} step={field.type === "price" || field.type === "money" ? 0.01 : undefined} onChange={value => setDraft(previous => ({ ...previous, [key]: value }))} />}
      </BlockStack>)}
     </div>
     <Text as="p" tone="subdued">특가 표시·추천 설정은 실제 유통기한과 Shopify 판매가격을 변경하지 않습니다. 날짜는 유통기한 관리에서 수정해주세요.</Text>
     <InlineStack gap="200"><Button variant="primary" loading={saving} disabled={busy || !selected.length || !Object.keys(patch).length} onClick={save}>선택한 속성 저장</Button><Button disabled={saving} onClick={() => setEditing(false)}>편집 닫기</Button></InlineStack>
    </BlockStack>
   </div>}
   <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse" }}>
    <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #d2d5d8" }}>
     <th style={{ padding: 12 }}><Checkbox label="속성 현재 페이지 전체 선택" labelHidden disabled={busy || !visible.length} checked={visible.length && checkedCount === visible.length ? true : checkedCount ? "indeterminate" : false} onChange={value => setSelected(previous => value ? [...new Set([...previous, ...visible.map(item => item.id)])] : previous.filter(id => !visible.some(item => item.id === id)))} /></th>
     <th style={{ padding: 12 }}>사진 · 상품 이름</th><th style={{ padding: 12 }}>재고</th><th style={{ padding: 12 }}>온도</th><th style={{ padding: 12 }}>현재 상품 속성</th><th style={{ padding: 12 }}>수정</th>
    </tr></thead>
    <tbody>{visible.map(item => <tr key={item.id} style={{ borderBottom: "1px solid #e1e3e5", background: selected.includes(item.id) ? "#eef6ff" : "transparent" }}>
     <td style={{ padding: 12 }}><Checkbox label={item.title + " 속성 선택"} labelHidden checked={selected.includes(item.id)} disabled={busy} onChange={value => setSelected(previous => value ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} /></td>
     <td style={{ padding: 12 }}><InlineStack gap="200" blockAlign="center">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" width="48" height="48" style={{ objectFit: "contain", borderRadius: 6 }} /> : <span>사진 없음</span>}<BlockStack gap="100"><Text as="p" fontWeight="semibold">{item.title}</Text><Text as="p" tone="subdued">{item.sku || "SKU 없음"}{" · ID " + item.id.split("/").pop()}</Text></BlockStack></InlineStack></td>
     <td style={{ padding: 12, whiteSpace: "nowrap" }}>{item.tracksInventory ? item.inventory === null ? "확인 불가" : item.inventory.toLocaleString("ko-KR") + "개" : "추적 안 함"}</td>
     <td style={{ padding: 12 }}>{item.storageTemp && <Badge>{TEMPERATURE_LABELS[item.storageTemp]}</Badge>}</td>
     <td style={{ padding: 12, minWidth: 230 }}>{attributeBadges(item)}</td>
     <td style={{ padding: 12 }}><Button disabled={busy} accessibilityLabel={item.title + " 속성 수정"} onClick={() => openEditor(item)}>수정</Button></td>
    </tr>)}</tbody>
   </table></div>
   {!visible.length && <p role="status">{loadStatus === "loading" ? "상품을 불러오는 중입니다." : "조건에 맞는 상품이 없습니다."}</p>}
   <InlineStack align="space-between" blockAlign="center">
    <Text as="p">{filtered.length + "개 상품 · " + currentPage + " / " + pageCount + "페이지"}</Text>
    <InlineStack gap="200"><Button disabled={busy || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</Button><Button disabled={busy || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button></InlineStack>
   </InlineStack>
  </BlockStack></Card>
 </BlockStack>;
}
