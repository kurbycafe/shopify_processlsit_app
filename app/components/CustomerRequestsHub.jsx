import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Banner, BlockStack, Button, ButtonGroup, Card, InlineStack, Modal, Select, Text, TextField } from "@shopify/polaris";
import { useFetcher } from "react-router";
import CustomerRequestsManager from "./CustomerRequestsManager.jsx";
import OrderInspectionSummary from "./common/OrderInspectionSummary.jsx";
import { optimizeShopifyImageUrl } from "../utils/shopifyImage.js";

const labels = { SUPPORT: "1:1 문의", CLAIM: "배송 문제", RETURN: "반품 · 교환" };
const states = { REQUESTED: "답변 필요", REVIEWING: "확인 중", CLOSED: "처리 완료" };
const templates = [
  { label: "답변 접수 확인 (확인 후 신속 안내)", value: "안녕하세요, 다와요 고객센터입니다. 문의해 주신 내용을 확인하고 있으며, 빠르게 확인 후 다시 안내해 드리겠습니다." },
  { label: "주문 및 배송 상태 확인 중", value: "불편을 드려 대단히 죄송합니다. 요청하신 주문의 포장 및 배송 상태를 물류팀과 확인 중입니다. 확인되는 즉시 안내드리겠습니다." },
  { label: "상품 파손 / 누락 사진 요청", value: "배송 중 파손 또는 누락으로 불편을 드려 죄송합니다. 신속한 교환/환불 처리를 위해 문제된 상품 상태와 송장 스티커가 보이는 사진을 보내주시면 감사하겠습니다." },
  { label: "반품 / 교환 수거 접수 완료", value: "반품(교환) 접수가 정상 완료되었습니다. 택배 기사님이 영업일 기준 1~3일 내 수거 방문 예정이며, 창고 입고 및 검수 완료 후 신속하게 처리해 드리겠습니다." },
  { label: "환불 / 적립금 지급 완료 안내", value: "요청하신 환불(적립금 지급) 처리가 정상적으로 완료되었습니다. 결제 수단에 따라 카드사 반영까지 영업일 기준 1~3일 소요될 수 있습니다." },
  { label: "추가 문의 안내 (상담 마무리)", value: "안내드린 내용 외에 추가로 궁금하신 사항이 있으시면 언제든지 편하게 말씀해 주세요. 감사합니다." },
];
const formatDate = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR") : "";
const messagesFor = record => {
  const p = record?.payload || {};
  const opening = p.message || p.reason || "";
  // Photos are sent with the inquiry itself, so they belong to its first message.
  const photos = Array.isArray(p.photos) ? p.photos.filter(src => typeof src === "string" && src) : [];
  const messages = Array.isArray(p.conversation) ? p.conversation : (p.reply || p.adminReply ? [{ id: "legacy", sender: "admin", text: p.reply || p.adminReply, createdAt: p.repliedAt }] : []);
  return [...(opening || photos.length ? [{ id: "opening", sender: "customer", text: opening, photos, createdAt: record.createdAt }] : []), ...messages];
};

function SupportInbox({ active = true }) {
  const list = useFetcher();
  const update = useFetcher();
  const load = list.load;
  const listRef = useRef(list); listRef.current = list;
  const [status, setStatus] = useState("REQUESTED");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const reply = drafts[selectedId] || "";
  const setReply = useCallback(value => setDrafts(current => ({ ...current, [selectedId]: value })), [selectedId]);
  const [internalDrafts, setInternalDrafts] = useState({});
  const note = internalDrafts[selectedId]?.note || "";
  const assignee = internalDrafts[selectedId]?.assignee || "";
  const setNote = value => setInternalDrafts(current => ({ ...current, [selectedId]: { ...current[selectedId], note: value } }));
  const setAssignee = value => setInternalDrafts(current => ({ ...current, [selectedId]: { ...current[selectedId], assignee: value } }));
  const [notice, setNotice] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const updateBefore = useRef(update.state);
  const replyFor = useRef(null);
  const url = useCallback((page = cursor) => {
    const params = new URLSearchParams({ group: "support", status });
    if (type) params.set("type", type);
    if (query.trim()) params.set("q", query.trim());
    if (page) params.set("cursor", page);
    return `/app/customer-requests?${params}`;
  }, [status, type, query, cursor]);
  useEffect(() => { const timer = setTimeout(() => { setCursor(null); setQuery(search); }, 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (active) load(url()); }, [active, load, url]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && listRef.current.state === "idle") load(url()); }, 30000);
    return () => clearInterval(timer);
  }, [active, load, url]);
  useEffect(() => {
    if (updateBefore.current !== "idle" && update.state === "idle") {
      if (update.data?.success) {
        if (replyFor.current && replyFor.current.text === reply && replyFor.current.id === selectedId) setReply("");
        setNotice(update.data.notificationQueued === false ? "답변은 저장됐지만 알림 등록을 확인하지 못했습니다." : "저장했습니다.");
        load(url());
      } else if (update.data?.error) setNotice(update.data.error);
      replyFor.current = null;
    }
    updateBefore.current = update.state;
  }, [update.state, update.data, load, url, reply, selectedId, setReply]);
  const rows = list.data?.requests || [];
  const selected = rows.find(row => row.id === selectedId) || null;
  const choose = row => { setSelectedId(row.id); setInternalDrafts(current => current[row.id] ? current : ({ ...current, [row.id]: { note: row.payload?.supportInternal?.note || "", assignee: row.payload?.supportInternal?.assignee || "" } })); setNotice(""); };
  const busy = update.state !== "idle";
  const send = () => {
    if (!selected || !selected.customerId || !reply.trim() || busy) return;
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) { setNotice("메시지 전송을 준비하지 못했습니다. 페이지를 새로고침해 주세요."); return; }
    replyFor.current = { id: selected.id, text: reply };
    update.submit({ intent: "conversation_message", id: selected.id, text: reply.trim(), messageId: id }, { method: "post", action: "/app/customer-requests" });
  };
  return <BlockStack gap="400">
    <Card><BlockStack gap="300"><Text as="h2" variant="headingLg">고객 상담함</Text><Text as="p" tone="subdued">문의와 반품을 한곳에서 확인하고 고객과 대화하세요.</Text>
      <InlineStack gap="200" align="start" blockAlign="center" wrap>
        <Text variant="bodyMd" fontWeight="semibold">상태 필터:</Text>
        <ButtonGroup variant="segmented">
          <Button
            pressed={status === "REQUESTED"}
            onClick={() => { setCursor(null); setSelectedId(null); setStatus("REQUESTED"); }}
          >
            답변 필요
          </Button>
          <Button
            pressed={status === "REVIEWING"}
            onClick={() => { setCursor(null); setSelectedId(null); setStatus("REVIEWING"); }}
          >
            확인 중
          </Button>
          <Button
            pressed={status === "CLOSED"}
            onClick={() => { setCursor(null); setSelectedId(null); setStatus("CLOSED"); }}
          >
            처리 완료
          </Button>
          <Button
            pressed={status === "ALL"}
            onClick={() => { setCursor(null); setSelectedId(null); setStatus("ALL"); }}
          >
            전체
          </Button>
        </ButtonGroup>
      </InlineStack>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <Select label="처리 상태" value={status} onChange={v => { setCursor(null); setSelectedId(null); setStatus(v); }} options={[{ label: "답변 필요", value: "REQUESTED" }, { label: "확인 중", value: "REVIEWING" }, { label: "처리 완료", value: "CLOSED" }, { label: "전체", value: "ALL" }]} />
        <Select label="문의 유형" value={type} onChange={v => { setCursor(null); setSelectedId(null); setType(v); }} options={[{ label: "전체 유형", value: "" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} />
        <TextField label="전체 문의 검색" helpText="주문번호, 이메일, 최초 접수 내용을 검색합니다." value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} placeholder="주문번호, 이메일, 문의 내용" />
      </div>
    </BlockStack></Card>
    {list.data?.error && <Banner tone="critical">{list.data.error}</Banner>}
    {notice && <Banner tone={update.data?.error || update.data?.notificationQueued === false ? "warning" : "success"}>{notice}</Banner>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "start" }}>
      <Card><BlockStack gap="200"><InlineStack align="space-between"><Text as="h3" variant="headingMd">문의 목록</Text><Button onClick={() => load(url())} loading={list.state !== "idle"}>새로고침</Button></InlineStack>
        {list.state !== "idle" && rows.length === 0 && <Text as="p" tone="subdued">문의 내역을 불러오는 중입니다…</Text>}
        {list.state === "idle" && !rows.length && !list.data?.error && <Text as="p" tone="subdued">조건에 맞는 문의가 없습니다.</Text>}
        {rows.map(row => <button key={row.id} type="button" onClick={() => choose(row)} aria-pressed={selectedId === row.id} style={{ width: "100%", textAlign: "left", border: selectedId === row.id ? "1.5px solid #303030" : "1px solid #e1e3e5", background: selectedId === row.id ? "#f6f6f7" : "#fff", borderRadius: 8, padding: 12, cursor: "pointer" }}>
          <strong>{labels[row.type] || row.type}</strong> · {states[row.status] || row.status}<br/><span style={{ color: "#616161", fontSize: 12 }}>{String(row.payload?.message || row.payload?.reason || "내용 없음").slice(0, 80)}</span><br/><span style={{ color: "#777", fontSize: 11 }}>{formatDate(row.updatedAt || row.createdAt)}</span>
        </button>)}
        <InlineStack gap="200">{cursor && <Button onClick={() => { setSelectedId(null); setCursor(null); }}>첫 페이지</Button>}{list.data?.nextCursor && <Button onClick={() => { setSelectedId(null); setCursor(list.data.nextCursor); }}>다음 페이지</Button>}</InlineStack>
      </BlockStack></Card>
      <Card>{!selected ? <Text as="p" tone="subdued">왼쪽에서 문의를 선택하면 대화 내용을 볼 수 있습니다.</Text> : <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">{labels[selected.type]} 대화</Text>
            <Badge tone={selected.status === "REQUESTED" ? "critical" : undefined}>
              {states[selected.status] || selected.status}
            </Badge>
          </InlineStack>
          {(() => {
            const rawOrderId = selected.payload?.orderId || selected.orderId || "";
            const numericOrderId = rawOrderId ? String(rawOrderId).split("/").pop() : "";
            const orderName = selected.payload?.orderName || (numericOrderId ? `#${numericOrderId}` : "");
            const shopStore = (list.data?.shop || "41vgwz-cp.myshopify.com").replace(".myshopify.com", "");
            const orderAdminUrl = numericOrderId
              ? `https://admin.shopify.com/store/${shopStore}/orders/${numericOrderId}`
              : orderName
              ? `https://admin.shopify.com/store/${shopStore}/orders?query=${encodeURIComponent(orderName)}`
              : null;
            return orderAdminUrl ? (
              <Button url={orderAdminUrl} target="_blank" size="micro">
                Shopify 주문 바로가기 &rarr;
              </Button>
            ) : null;
          })()}
        </InlineStack>
        <InlineStack gap="300" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            주문: {selected.payload?.orderName || selected.payload?.orderId || selected.orderId || "주문 정보 없음"}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">·</Text>
          <Text as="span" variant="bodySm" tone="subdued">
            고객: {selected.payload?.email ? (
              <a href={`mailto:${selected.payload.email}`} style={{ color: "#303030", textDecoration: "underline" }}>
                {selected.payload.email}
              </a>
            ) : (
              selected.customerId || "비로그인 접수"
            )}
          </Text>
        </InlineStack>
        <OrderInspectionSummary
          orderRef={selected.payload?.orderName || selected.payload?.orderId || selected.orderId}
          inspection={selected.inspection}
        />
        <div style={{ background: "#f6f7f8", borderRadius: 10, padding: 14, display: "grid", gap: 10, maxHeight: 420, overflowY: "auto", border: "1px solid #e1e3e5" }}>
          {messagesFor(selected).map(item => <div key={item.id} style={{ justifySelf: item.sender === "admin" ? "end" : "start", maxWidth: "88%" }}><div style={{ fontSize: 11, color: "#616161", marginBottom: 4 }}>{item.sender === "admin" ? "관리자" : "고객"} · {formatDate(item.createdAt)}</div><div style={{ background: item.sender === "admin" ? "#303030" : "#fff", color: item.sender === "admin" ? "#fff" : "#303030", border: item.sender === "admin" ? "none" : "1px solid #e1e3e5", padding: "10px 12px", borderRadius: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text}{item.photos?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: item.text ? 8 : 0 }}>{item.photos.map((src, index) => <button key={index} type="button" onClick={() => setSelectedPhoto(src)} aria-label={`첨부 사진 ${index + 1} 확대`} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer" }}><img src={optimizeShopifyImageUrl(src, 160)} alt="" width={72} height={72} loading="lazy" decoding="async" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} /></button>)}</div>}</div></div>)}
        </div>
        {!selected.customerId && <Banner tone="warning">로그인 계정이 연결되지 않은 문의입니다. 앱 대화와 푸시로 답변을 전달할 수 없으므로, 등록된 이메일 등으로 별도 안내해 주세요.</Banner>}
        <TextField label="고객에게 답변" value={reply} onChange={setReply} multiline={3} maxLength={4000} autoComplete="off" placeholder="고객에게 안내할 내용을 입력하세요" />
        <Select
          label="자주 쓰는 답변 템플릿"
          value=""
          onChange={val => {
            if (val) setReply(prev => (prev ? `${prev}\n\n${val}` : val));
          }}
          options={[
            { label: "답변 템플릿을 선택하여 본문에 추가", value: "" },
            ...templates.map(t => ({ label: t.label, value: t.value }))
          ]}
        />
        <InlineStack gap="200" align="end"><Button variant="primary" onClick={send} loading={busy} disabled={!selected.customerId || !reply.trim() || busy}>답변 보내기</Button><Button onClick={() => update.submit({ id: selected.id, status: "CLOSED" }, { method: "post", action: "/app/customer-requests" })} disabled={busy || selected.status === "CLOSED"}>처리 완료</Button></InlineStack>
        <details><summary>담당자와 내부 메모 (고객에게 보이지 않음)</summary><div style={{display:"grid",gap:10,marginTop:12}}><TextField label="담당자" value={assignee} onChange={setAssignee} maxLength={100} autoComplete="off"/><TextField label="내부 메모" value={note} onChange={setNote} multiline={3} maxLength={4000} autoComplete="off"/><Button onClick={() => update.submit({ intent: "conversation_internal", id: selected.id, note, assignee }, { method: "post", action: "/app/customer-requests" })} disabled={busy}>내부 메모 저장</Button></div></details>
      </BlockStack>}</Card>
    </div>
    <Modal open={Boolean(selectedPhoto)} onClose={() => setSelectedPhoto(null)} title="첨부 사진" secondaryActions={[{ content: "닫기", onAction: () => setSelectedPhoto(null) }]}><Modal.Section>{selectedPhoto && <img src={selectedPhoto} alt="확대한 첨부 사진" style={{maxWidth:"100%",maxHeight:"70vh",objectFit:"contain"}} />}</Modal.Section></Modal>
  </BlockStack>;
}

export default function CustomerRequestsHub({ active = true }) {
  const [view, setView] = useState("inbox");
  return <BlockStack gap="400"><InlineStack gap="200"><Button pressed={view === "inbox"} onClick={() => setView("inbox")}>상담함</Button><Button pressed={view === "other"} onClick={() => setView("other")}>전체 요청 관리</Button></InlineStack>{view === "inbox" ? <SupportInbox active={active}/> : <CustomerRequestsManager readOnlyReplies/>}</BlockStack>;
}
