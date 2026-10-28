import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Banner, BlockStack, Button, Card, InlineStack, Modal, Select, Text, TextField } from "@shopify/polaris";
import { useFetcher } from "react-router";
import CustomerRequestsManager from "./CustomerRequestsManager.jsx";

const labels = { SUPPORT: "1:1 문의", CLAIM: "배송 문제", RETURN: "반품 · 교환" };
const states = { REQUESTED: "답변 필요", REVIEWING: "확인 중", CLOSED: "처리 완료" };
const templates = ["안녕하세요. 문의해 주셔서 감사합니다. 확인 후 안내드리겠습니다.", "불편을 드려 죄송합니다. 주문 내용을 확인하고 다시 안내드리겠습니다.", "안내드린 내용에 추가로 궁금한 점이 있으시면 말씀해 주세요."];
const formatDate = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR") : "";
const messagesFor = record => {
  const p = record?.payload || {};
  const opening = p.message || p.reason || "";
  const messages = Array.isArray(p.conversation) ? p.conversation : (p.reply || p.adminReply ? [{ id: "legacy", sender: "admin", text: p.reply || p.adminReply, createdAt: p.repliedAt }] : []);
  return [...(opening ? [{ id: "opening", sender: "customer", text: opening, createdAt: record.createdAt }] : []), ...messages];
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
  const setReply = value => setDrafts(current => ({ ...current, [selectedId]: value }));
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
  }, [update.state, update.data, load, url, reply, selectedId]);
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
        {rows.map(row => <button key={row.id} type="button" onClick={() => choose(row)} aria-pressed={selectedId === row.id} style={{ width: "100%", textAlign: "left", border: selectedId === row.id ? "1px solid #2c6ecb" : "1px solid #e1e3e5", background: selectedId === row.id ? "#f1f7ff" : "#fff", borderRadius: 12, padding: 12, cursor: "pointer" }}>
          <strong>{labels[row.type] || row.type}</strong> · {states[row.status] || row.status}<br/><span style={{ color: "#616161", fontSize: 12 }}>{String(row.payload?.message || row.payload?.reason || "내용 없음").slice(0, 80)}</span><br/><span style={{ color: "#777", fontSize: 11 }}>{formatDate(row.updatedAt || row.createdAt)}</span>
        </button>)}
        <InlineStack gap="200">{cursor && <Button onClick={() => { setSelectedId(null); setCursor(null); }}>첫 페이지</Button>}{list.data?.nextCursor && <Button onClick={() => { setSelectedId(null); setCursor(list.data.nextCursor); }}>다음 페이지</Button>}</InlineStack>
      </BlockStack></Card>
      <Card>{!selected ? <Text as="p" tone="subdued">왼쪽에서 문의를 선택하면 대화 내용을 볼 수 있습니다.</Text> : <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center"><Text as="h3" variant="headingMd">{labels[selected.type]} 대화</Text><Badge>{states[selected.status] || selected.status}</Badge></InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">{selected.payload?.orderName || selected.payload?.orderId || selected.orderId || "주문 정보 없음"} · {selected.payload?.email || selected.customerId || "비로그인 접수"}</Text>
        <div style={{ background: "#f6f7f8", borderRadius: 12, padding: 14, display: "grid", gap: 10, maxHeight: 420, overflowY: "auto" }}>
          {messagesFor(selected).map(item => <div key={item.id} style={{ justifySelf: item.sender === "admin" ? "end" : "start", maxWidth: "88%" }}><div style={{ fontSize: 11, color: "#616161", marginBottom: 4 }}>{item.sender === "admin" ? "관리자" : "고객"} · {formatDate(item.createdAt)}</div><div style={{ background: item.sender === "admin" ? "#dcecff" : "#fff", padding: "10px 12px", borderRadius: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text}</div></div>)}
        </div>
        {Array.isArray(selected.payload?.photos) && selected.payload.photos.length > 0 && <details><summary>첨부 사진 {selected.payload.photos.length}장</summary><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>{selected.payload.photos.map((src, index) => <button key={index} type="button" onClick={() => setSelectedPhoto(src)} aria-label={`첨부 사진 ${index + 1} 확대`} style={{padding:0,border:0,background:"transparent",cursor:"pointer"}}><img src={src} alt="" style={{width:80,height:80,objectFit:"cover",borderRadius:8}} /></button>)}</div></details>}
        {!selected.customerId && <Banner tone="warning">로그인 계정이 연결되지 않은 문의입니다. 앱 대화와 푸시로 답변을 전달할 수 없으므로, 등록된 이메일 등으로 별도 안내해 주세요.</Banner>}
        <TextField label="고객에게 답변" value={reply} onChange={setReply} multiline={3} maxLength={4000} autoComplete="off" placeholder="고객에게 안내할 내용을 입력하세요" />
        <Select label="자주 쓰는 답변" value="" onChange={value => { if (value) setReply(value); }} options={[{ label: "답변 문구 선택", value: "" }, ...templates.map(value => ({ label: value, value }))]} />
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
