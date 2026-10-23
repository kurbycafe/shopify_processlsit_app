import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import { TEMPERATURE_LABELS } from "../utils/productTemperatures.js";

const ENDPOINT = "/app/product-temperatures";
const PAGE_SIZE = 50;
const TEMPERATURE_OPTIONS = [
  { label: "전체 온도", value: "all" }, { label: "미설정", value: "unset" },
  ...Object.entries(TEMPERATURE_LABELS).map(([value, label]) => ({ value, label })),
];
async function resultJson(response) {
  if (response.status === 401 || response.status === 403) throw new Error("로그인이 만료되었거나 권한이 없습니다. 앱을 다시 열어주세요.");
  let result;
  try { result = await response.json(); } catch { throw new Error("서버 응답을 읽지 못했습니다. 앱을 다시 열거나 새로고침해주세요."); }
  if (!response.ok || result.success !== true) {
    const error = new Error(result.message || "요청에 실패했습니다. 다시 시도해주세요.");
    error.details = result.details;
    error.status = response.status;
    throw error;
  }
  return result;
}

export default function ProductTemperatureManager() {
  const [items, setItems] = useState([]);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [temperature, setTemperature] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [targetTemp, setTargetTemp] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadedAt, setLoadedAt] = useState(null);
  const saveAbort = useRef(null);
  const saveRunning = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setItems([]); setSelected([]); setPage(1); setLoadStatus("loading"); setLoadError(""); setSuccess(""); setSaveError(""); setLoadedAt(null);
    void (async () => {
      let after = null;
      const cursors = new Set();
      try {
        do {
          const url = ENDPOINT + (after ? "?after=" + encodeURIComponent(after) : "");
          const data = await resultJson(await fetch(url, { signal: controller.signal, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }));
          if (!Array.isArray(data.items) || typeof data.pageInfo?.hasNextPage !== "boolean") throw new Error("상품 목록 응답이 올바르지 않습니다.");
          if (!current) return;
          setItems(previous => [...new Map([...previous, ...data.items].map(item => [item.id, item])).values()]);
          if (!data.pageInfo.hasNextPage) break;
          const next = data.pageInfo.endCursor;
          if (!next || cursors.has(next)) throw new Error("상품의 다음 페이지를 불러오지 못했습니다. 다시 조회해주세요.");
          cursors.add(next); after = next;
        } while (current);
        if (current) { setLoadStatus("ready"); setLoadedAt(new Date().toLocaleTimeString("ko-KR")); }
      } catch (error) {
        if (current && error.name !== "AbortError") { setLoadStatus("error"); setLoadError(error.message); }
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [reloadKey]);
  useEffect(() => () => saveAbort.current?.abort(), []);

  const deferredQuery = useDeferredValue(query);
  const counts = useMemo(() => items.reduce((result, item) => {
    result[item.storageTemp || "unset"]++;
    return result;
  }, { unset: 0, ambient: 0, chilled: 0, frozen: 0 }), [items]);
  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase();
    return items.filter(item => (!term || item.title.toLocaleLowerCase().includes(term) || item.id.split("/").pop().includes(term)) &&
      (temperature === "all" || (temperature === "unset" ? !item.storageTemp : item.storageTemp === temperature)));
  }, [items, deferredQuery, temperature]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedVisible = visible.filter(item => selected.includes(item.id)).length;
  const allChecked = visible.length > 0 && selectedVisible === visible.length;
  const busy = saving || loadStatus !== "ready";
  const resetSelection = () => { setSelected([]); setSuccess(""); setSaveError(""); };
  const changeQuery = value => { setQuery(value); setPage(1); resetSelection(); };
  const changeFilter = value => { setTemperature(value); setPage(1); resetSelection(); };
  const changePage = value => { setPage(value); };

  const save = async () => {
    if (saveRunning.current || busy || !selected.length || !targetTemp) return;
    saveRunning.current = true;
    const controller = new AbortController(); saveAbort.current = controller;
    const ids = [...selected];
    setSaving(true); setSaveError(""); setSuccess(""); setSaveProgress({ completed: 0, total: ids.length });
    const completed = new Set();
    let activeBatch = [];
    const applyConfirmed = confirmedIds => {
      for (const id of confirmedIds) if (ids.includes(id)) completed.add(id);
      setItems(previous => previous.map(item => completed.has(item.id) ? { ...item, storageTemp: targetTemp, temperatureUncertain: false } : item));
      setSelected(previous => previous.filter(id => !completed.has(id)));
      setSaveProgress({ completed: completed.size, total: ids.length });
    };
    try {
      // Selection is unlimited. Keep individual HTTP requests short and within Shopify's limit.
      for (let offset = 0; offset < ids.length; offset += 25) {
        const batch = ids.slice(offset, offset + 25);
        activeBatch = batch;
        const data = await resultJson(await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ productIds: batch, storageTemp: targetTemp }) }));
        if (data.updatedCount !== batch.length || data.storageTemp !== targetTemp || !data.saveId ||
            !Array.isArray(data.productIds) || batch.some(id => !data.productIds.includes(id))) {
          const error = new Error("저장 결과를 확인하지 못했습니다. 상품을 다시 조회해주세요.");
          error.details = { storageTemp: targetTemp, uncertainProductIds: batch, updatedProductIds: [] };
          throw error;
        }
        applyConfirmed(batch);
      }
      setSuccess(completed.size + "개 상품을 " + TEMPERATURE_LABELS[targetTemp] + "으로 저장했습니다.");
    } catch (error) {
      if (error.name !== "AbortError") {
        const details = error.details?.storageTemp ? error.details : (!error.status || error.status >= 500 ? { storageTemp: targetTemp, uncertainProductIds: activeBatch } : null);
        if (details?.storageTemp === targetTemp) {
          if (Array.isArray(details.updatedProductIds)) applyConfirmed(details.updatedProductIds);
          if (Array.isArray(details.uncertainProductIds) && details.uncertainProductIds.length) {
            const uncertain = new Set(details.uncertainProductIds.filter(id => ids.includes(id) && !completed.has(id)));
            setItems(previous => previous.map(item => uncertain.has(item.id) ? { ...item, storageTemp: "", temperatureUncertain: true } : item));
          }
        }
        setSaveError((completed.size ? completed.size + "개 상품은 저장되었고 " + (ids.length - completed.size) + "개 상품 처리가 중단되었습니다. " : "") + error.message);
      }
    } finally {
      saveRunning.current = false;
      if (!controller.signal.aborted) { setSaving(false); setSaveProgress(null); }
    }
  };

  return <BlockStack gap="400">
    <Card><BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">상품 온도 관리</Text>
          <Text as="p" tone="subdued">Shopify custom.producttype 기준입니다. t = 상온 · k = 냉장 · tk = 냉동. 일괄 변경 시 이 메타필드에 저장합니다.</Text>
        </BlockStack>
        <Button onClick={() => setReloadKey(value => value + 1)} disabled={saving} loading={loadStatus === "loading"}>상품 새로고침</Button>
      </InlineStack>
      {loadStatus === "loading" && <Banner tone="info"><p role="status">Shopify 상품을 불러오는 중입니다. {items.length}개 조회됨 · 조회 완료 후 전체 상품 기준으로 필터링하고 수정할 수 있습니다.</p></Banner>}
      {loadError && <Banner tone="critical" title="상품 목록을 끝까지 불러오지 못했습니다"><p>{loadError} 현재 보이는 {items.length}개는 일부 목록입니다.</p></Banner>}
      <InlineStack gap="200">
        <Badge>{"조회 상품 " + items.length + "개"}</Badge>
        <Badge tone="attention">{"미설정 " + counts.unset + "개"}</Badge>
        {Object.entries(TEMPERATURE_LABELS).map(([value, label]) => <Badge key={value}>{label + " " + counts[value] + "개"}</Badge>)}
      </InlineStack>
      <InlineStack gap="400" blockAlign="end" wrap>
        <div style={{ flex: "1 1 280px" }}><TextField label="상품 검색" placeholder="상품명 또는 상품 ID 검색" value={query} onChange={changeQuery} autoComplete="off" clearButton onClearButtonClick={() => changeQuery("")} disabled={saving} /></div>
        <div style={{ flex: "0 1 220px" }}><Select label="현재 보관 온도" options={TEMPERATURE_OPTIONS} value={temperature} onChange={changeFilter} disabled={saving} /></div>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">재고량은 Shopify의 상품별 총재고입니다. 온도 변경으로 재고·가격·MHD는 변경되지 않습니다. 미설정은 상온과 별도로 표시합니다.</Text>
    </BlockStack></Card>

    <Card><BlockStack gap="300">
      {success && <Banner tone="success"><p role="status">{success}</p></Banner>}
      {saveError && <Banner tone="critical"><p>{saveError} 완료되지 않은 상품은 선택 상태로 유지됩니다.</p></Banner>}
      {saveProgress && <p role="status">{"저장 중 " + saveProgress.completed + " / " + saveProgress.total + "개"}</p>}
      <InlineStack gap="300" blockAlign="end" align="space-between">
        <BlockStack gap="100"><Text as="h3" variant="headingSm">{selected.length + "개 선택됨"}</Text><Text as="p" variant="bodySm" tone="subdued">페이지를 이동해도 선택이 유지됩니다. 검색 결과 전체 선택으로 모든 페이지의 상품을 선택할 수 있습니다.</Text></BlockStack>
        <InlineStack gap="200" blockAlign="end">
          <Select label="변경할 온도" value={targetTemp} disabled={busy} onChange={setTargetTemp}
            options={[{ label: "온도 선택", value: "" }, ...Object.entries(TEMPERATURE_LABELS).map(([value, label]) => ({ value, label }))]} />
          <Button variant="primary" loading={saving} disabled={busy || !selected.length || !targetTemp} onClick={save}>선택 상품 일괄 변경</Button>
        </InlineStack>
      </InlineStack>
      <InlineStack gap="200">
        <Button disabled={busy || !filtered.length} onClick={() => { setSelected(filtered.map(item => item.id)); setSaveError(""); setSuccess(""); }}>{"검색 결과 전체 " + filtered.length + "개 선택"}</Button>
        <Button disabled={busy || !selected.length} onClick={resetSelection}>선택 해제</Button>
      </InlineStack>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px" }}>
          <thead><tr style={{ borderBottom: "2px solid #e1e3e5", background: "#f6f6f7", textAlign: "left" }}>
            <th scope="col" style={{ width: "50px", padding: "12px" }}><Checkbox label="현재 페이지 전체 선택" labelHidden
              checked={allChecked ? true : selectedVisible ? "indeterminate" : false} disabled={busy || !visible.length}
              onChange={value => setSelected(previous => value ? [...new Set([...previous, ...visible.map(item => item.id)])] : previous.filter(id => !visible.some(item => item.id === id)))} /></th>
            <th scope="col" style={{ padding: "12px", width: "88px" }}>사진</th>
            <th scope="col" style={{ padding: "12px" }}>상품 이름</th>
            <th scope="col" style={{ padding: "12px", textAlign: "right" }}>재고량</th>
            <th scope="col" style={{ padding: "12px", width: "110px" }}>현재 온도</th>
          </tr></thead>
          <tbody>{visible.map(item => <tr key={item.id} style={{ borderBottom: "1px solid #e1e3e5", background: selected.includes(item.id) ? "#eef6ff" : "transparent" }}>
            <td style={{ padding: "12px" }}><Checkbox label={item.title + " 선택"} labelHidden checked={selected.includes(item.id)} disabled={busy}
              onChange={value => setSelected(previous => value ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} /></td>
            <td style={{ padding: "12px" }}>{item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt} loading="lazy" width="56" height="56" style={{ objectFit: "contain", borderRadius: "8px", background: "#f6f6f7" }} />
              : <span style={{ color: "#6d7175", fontSize: "12px" }}>사진 없음</span>}</td>
            <td style={{ padding: "12px" }}><Text as="p" fontWeight="semibold">{item.title}</Text><Text as="p" variant="bodySm" tone="subdued">{"ID " + item.id.split("/").pop()}</Text></td>
            <td style={{ padding: "12px", textAlign: "right", whiteSpace: "nowrap" }}>{item.tracksInventory ? (item.inventory === null ? "확인 불가" : item.inventory.toLocaleString("ko-KR") + "개") : "재고 추적 안 함"}</td>
            <td style={{ padding: "12px" }}>{item.temperatureUncertain ? "확인 필요" : item.storageTemp ? <Badge tone="info">{TEMPERATURE_LABELS[item.storageTemp]}</Badge> : "—"}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <div style={{ padding: "36px 16px", textAlign: "center", color: "#6d7175" }} role="status">{loadStatus === "loading" ? "상품 목록을 불러오는 중입니다." : loadStatus === "error" ? "조회가 완료되지 않았습니다. 다시 조회해주세요." : "조건에 맞는 상품이 없습니다."}</div>}
      </div>
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <Text as="p" variant="bodySm" tone="subdued">{filtered.length + "개 상품 · " + currentPage + " / " + pageCount + "페이지 · 페이지당 " + PAGE_SIZE + "개" + (loadedAt ? " · 조회 " + loadedAt : "")}</Text>
        <InlineStack gap="200">
          <Button disabled={saving || currentPage === 1} onClick={() => changePage(currentPage - 1)}>이전</Button>
          <Button disabled={saving || currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>다음</Button>
        </InlineStack>
      </InlineStack>
    </BlockStack></Card>
  </BlockStack>;
}
