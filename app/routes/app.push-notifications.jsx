import { randomUUID } from "node:crypto";
import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "react-router";
import { Page, Card, BlockStack, Text, TextField, Select, Button, InlineStack, Banner, Modal, Checkbox, DataTable, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import db from "../db.server.js";
import { createPushCampaign, expandPushCampaigns, listPushAdmin, retryPushDelivery } from "../services/mobilePushAdmin.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";
import { firebasePushConfigured } from "../services/firebaseMessaging.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try { return { ...(await listPushAdmin({ db, shop: session.shop, cursor: new URL(request.url).searchParams.get("cursor") })), configured: firebasePushConfigured(), requestId: randomUUID() }; }
  catch { return { records: [], nextCursor: null, configured: firebasePushConfigured(), requestId: randomUUID(), error: "알림 발송 기록을 불러오지 못했습니다." }; }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "process") {
      await expandPushCampaigns({ db, shop: session.shop });
      const result = await dispatchMobileNotifications({ db, shop: session.shop, limit: 50 });
      if (!result.configured) return { error: "Firebase 발송 서버 인증 설정이 필요합니다." };
      return { message: `대기열 처리 완료: ${result.processed}건. SENT는 FCM 접수 상태이며 기기 수신 확인과 다릅니다.` };
    }
    if (form.get("intent") === "retry") {
      await retryPushDelivery({ db, shop: session.shop, id: String(form.get("id") || ""), acknowledgeUnknown: form.get("acknowledgeUnknown") === "true" });
      return { message: "재시도 대기열에 등록했습니다." };
    }
    if (form.get("intent") !== "campaign") throw Error();
    const customerIds = String(form.get("customerIds") || "").split(/[\s,]+/).filter(Boolean);
    if (form.get("test") === "true" && customerIds.length !== 1) return { error: "테스트 발송은 고객 ID 한 개를 지정해주세요." };
    const productId = String(form.get("productId") || "").trim();
    await createPushCampaign({ db, shop: session.shop, input: { title: String(form.get("title") || ""), body: String(form.get("body") || ""), category: String(form.get("category") || ""),
      customerIds, requestId: String(form.get("requestId") || ""), scheduledAt: form.get("scheduledAt") || null, target: productId ? { type: "product", id: productId } : { type: "home" } } });
    return { message: "발송 요청을 저장했습니다. 수신 동의·야간 시간 설정을 확인한 뒤 대기열에서 처리합니다." };
  } catch (error) { return { error: error.status ? error.message : "발송 요청을 처리하지 못했습니다. 기록을 확인해주세요." }; }
};

export default function PushNotificationsPage() {
  const data = useLoaderData(), result = useActionData(), navigation = useNavigation(), submit = useSubmit();
  const busy = navigation.state !== "idle";
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [category, setCategory] = useState("EVENT");
  const [customerIds, setCustomerIds] = useState(""), [productId, setProductId] = useState(""), [schedule, setSchedule] = useState("");
  const [test, setTest] = useState(false), [confirm, setConfirm] = useState(null), [acknowledge, setAcknowledge] = useState(false);
  const sendConfirmed = () => {
    if (confirm.type === "process") submit({ intent: "process" }, { method: "post" });
    else if (confirm.type === "retry") submit({ intent: "retry", id: confirm.id, acknowledgeUnknown: String(acknowledge) }, { method: "post" });
    else submit({ intent: "campaign", title, body, category, customerIds, productId, scheduledAt: schedule ? new Date(schedule).toISOString() : "", requestId: data.requestId, test: String(test) }, { method: "post" });
    setConfirm(null); setAcknowledge(false);
  };
  return <Page title="앱 알림 발송 및 기록" fullWidth><BlockStack gap="400">
    {!data.configured && <Banner tone="warning" title="발송 서버 연결이 필요합니다"><p>기기 등록과 별도로 Firebase 발송 인증 및 예약 대기열 실행 설정이 필요합니다. 현재 요청은 저장되며 발송되지 않습니다.</p></Banner>}
    {(data.error || result?.error) && <Banner tone="critical"><p>{result?.error || data.error}</p></Banner>}
    {result?.message && <Banner tone="success"><p>{result.message}</p></Banner>}
    <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">새 알림</Text>
      <TextField label="제목" value={title} onChange={setTitle} maxLength={120} autoComplete="off" />
      <TextField label="내용" value={body} onChange={setBody} multiline={3} maxLength={1000} autoComplete="off" />
      <Select label="수신 동의 유형" value={category} onChange={setCategory} options={[{ label: "행사·혜택", value: "EVENT" }, { label: "마케팅", value: "MARKETING" }]} />
      <TextField label="대상 Shopify 고객 ID" helpText="쉼표 또는 줄바꿈으로 구분, 최대 100명. 비우면 해당 유형을 동의한 고객 전체." value={customerIds} onChange={setCustomerIds} multiline={2} autoComplete="off" />
      <TextField label="연결 상품 ID (선택)" helpText="gid://shopify/Product/숫자. 비우면 홈으로 이동합니다." value={productId} onChange={setProductId} autoComplete="off" />
      <label>예약 시각 (관리자 PC 현지 시각)<input type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /></label>
      <Checkbox label="테스트 발송 (대상 고객 한 명 지정)" checked={test} onChange={setTest} />
      <Button variant="primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => setConfirm({ type: "campaign" })}>발송 내용 확인</Button>
    </BlockStack></Card>
    <Card><BlockStack gap="300"><InlineStack align="space-between"><Text as="h2" variant="headingMd">발송 대기열·기록</Text><Button disabled={busy || !data.configured} onClick={() => setConfirm({ type: "process" })}>대기열 처리</Button></InlineStack>
      <Text as="p">SENT: FCM 접수. UNKNOWN: 결과 미확정. 수신 거부·기기 연결 해제·만료 알림은 SKIPPED로 처리합니다.</Text>
      {!data.records.length ? <Text as="p">발송 기록이 없습니다.</Text> : <DataTable columnContentTypes={["text", "text", "text", "text", "text"]} headings={["유형 / 제목", "상태", "고객", "시도 / 오류", "재시도"]} rows={data.records.map(row => [row.title || row.type, <Badge key={row.id}>{row.status}</Badge>, row.customerId || "동의 고객 대상", `${row.attempts} / ${row.errorCode || "—"}`, ["FAILED", "UNKNOWN"].includes(row.status) ? <Button key={row.id} disabled={busy} onClick={() => { setAcknowledge(false); setConfirm({ type: "retry", id: row.id, unknown: row.status === "UNKNOWN" }); }}>재시도 확인</Button> : "—"])} />}
      {data.nextCursor && <Link to={`?cursor=${encodeURIComponent(data.nextCursor)}`}>이전 기록 보기</Link>}
    </BlockStack></Card>
    <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm?.type === "process" ? "대기 중인 알림을 발송하시겠습니까?" : confirm?.type === "retry" ? "다시 발송하시겠습니까?" : "이 내용으로 발송 요청을 저장하시겠습니까?"}
      primaryAction={{ content: "확인 후 저장", onAction: sendConfirmed, disabled: busy || (confirm?.unknown && !acknowledge) }} secondaryActions={[{ content: "취소", onAction: () => setConfirm(null) }]}>
      <Modal.Section>{confirm?.type === "campaign" ? <BlockStack gap="200"><Text as="h3" variant="headingMd">{title}</Text><Text as="p">{body}</Text><Text as="p">대상: {customerIds || "해당 유형 수신 동의 고객 전체"} / {schedule || "다음 대기열 실행 시"}</Text></BlockStack> : <Text as="p">발송 직전에 고객의 현재 수신 설정과 기기 연결을 다시 확인합니다.</Text>}
        {confirm?.unknown && <Checkbox label="기존 발송이 도착했을 수 있으며 중복 수신 가능성을 확인했습니다." checked={acknowledge} onChange={setAcknowledge} />}
      </Modal.Section>
    </Modal>
  </BlockStack></Page>;
}
