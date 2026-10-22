import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Badge, Banner, BlockStack, Button, Card, InlineStack, Page, Select, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { listCustomerRequests, updateCustomerRequest } from "../services/customerRequests.server.js";
import { MobileApiError } from "../services/mobileApi.server.js";

const LABELS = { REQUESTED: "접수", REVIEWING: "확인 중", CLOSED: "처리 완료" };
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const search = new URL(request.url).searchParams;
  const status = search.get("status") || "REQUESTED";
  try {
    return { ...await listCustomerRequests({ db: prisma, shop: session.shop, status, after: search.get("cursor") }), status, error: null };
  } catch (error) {
    return Response.json({ requests: [], nextCursor: null, status,
      error: error instanceof MobileApiError ? error.message : "고객 요청을 불러오지 못했습니다. 다시 시도해주세요." },
    { status: error instanceof MobileApiError ? error.status : 503 });
  }
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST") return Response.json({ error: "POST 요청이 필요합니다." }, { status: 405, headers: { Allow: "POST" } });
  const form = await request.formData();
  try {
    return await updateCustomerRequest({ db: prisma, shop: session.shop, id: form.get("id"), status: form.get("status") });
  } catch (error) {
    return Response.json({ error: error instanceof MobileApiError ? error.message : "요청 상태를 저장하지 못했습니다. 다시 시도해주세요." },
      { status: error instanceof MobileApiError ? error.status : 503 });
  }
};

export default function CustomerRequests() {
  const { requests, status, nextCursor, error } = useLoaderData();
  const fetcher = useFetcher();
  const [, setSearch] = useSearchParams();
  const update = (id, nextStatus) => fetcher.submit({ id, status: nextStatus }, { method: "post" });
  return <Page title="고객 문의 · 반품 접수" subtitle="모바일에서 저장된 요청을 확인하고 담당자가 처리 상태를 관리합니다. 상태 변경은 환불이나 반품 승인을 실행하지 않습니다.">
    <BlockStack gap="400">
      {(error || fetcher.data?.error) && <Banner tone="critical">{error || fetcher.data.error}</Banner>}
      <Card>
        <Select label="처리 상태" value={status} options={[
          { label: "접수", value: "REQUESTED" }, { label: "확인 중", value: "REVIEWING" },
          { label: "처리 완료", value: "CLOSED" }, { label: "전체", value: "ALL" },
        ]} onChange={(value) => setSearch({ status: value })} />
      </Card>
      {!requests.length && !error && <Card><Text as="p">해당 상태의 접수 내역이 없습니다.</Text></Card>}
      {requests.map((record) => {
        const detail = record.payload || {};
        const TYPE_TITLES = {
          B2B: "사업자 문의",
          RETURN: "반품 · 교환 요청",
          SUPPORT: "1:1 고객 문의",
          CLAIM: "배송 파손 · 클레임 접수",
          SUBSCRIPTION: "정기구독(Abo) 신청",
          PHOTO_REVIEW: "포토 후기 등록",
          COMMUNITY_POST: "커뮤니티 게시글", COMMUNITY_COMMENT: "커뮤니티 댓글", ACCOUNT_DELETE: "계정 삭제 요청",
        };
        const fields = record.type === "B2B"
          ? [["회사", detail.companyName], ["이메일", detail.email], ["담당자", detail.contactName], ["전화", detail.phone], ["VAT", detail.vatId], ["문의", detail.message]]
          : record.type === "SUPPORT" || record.type === "CLAIM"
          ? [["주문", detail.orderId || record.orderId], ["고객 ID", record.customerId], ["이메일", detail.email], ["유형", detail.claimType || "일반 문의"], ["첨부 사진", detail.photoCount ? `${detail.photoCount}장` : null], ["내용", detail.message]]
          : record.type === "SUBSCRIPTION"
          ? [["플랜", detail.planTitle], ["주기", detail.frequency === "biweekly" ? "2주 1회" : "월 1회"], ["금액", detail.price ? `€${detail.price}` : null], ["이메일", detail.email], ["고객 ID", record.customerId]]
          : record.type === "PHOTO_REVIEW"
          ? [["작성자", detail.userName], ["요리명", detail.dishName], ["별점", detail.rating ? `${detail.rating}점` : null], ["후기", detail.comment], ["좋아요", detail.likes != null ? `${detail.likes}` : null]]
          : record.type === "ACCOUNT_DELETE"
          ? [["고객 ID",record.customerId],["삭제 요청 사유",detail.reason]]
          : record.type === "COMMUNITY_POST"
          ? [["작성자",detail.author],["제목",detail.title],["내용",detail.content]]
          : record.type === "COMMUNITY_COMMENT"
          ? [["원문 ID",detail.postId],["작성자",detail.author],["댓글",detail.text]]
          : record.type === "RETURN"
          ? [["주문", detail.orderName || record.orderId], ["고객 ID", record.customerId], ["유형", detail.type === "exchange" ? "교환" : "반품"], ["상품", detail.productName], ["사유", detail.reason]] : [];
        return <Card key={record.id}>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">{TYPE_TITLES[record.type] || "고객 요청"}</Text>
              <Badge>{LABELS[record.status] || record.status}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">접수 번호: {record.id} · {new Date(record.createdAt).toLocaleString("de-DE")}</Text>
            {fields.filter(([, value]) => value).map(([label, value]) => <Text as="p" key={label}>{label}: {value}</Text>)}
            {Array.isArray(detail.photos) && detail.photos.length > 0 && (
              <InlineStack gap="200">
                {detail.photos.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    <img src={src} alt={`첨부 ${i + 1}`} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
                  </a>
                ))}
              </InlineStack>
            )}
            <InlineStack gap="200">
              {Object.entries(LABELS).filter(([nextStatus]) => nextStatus !== record.status).map(([nextStatus, label]) =>
                <Button key={nextStatus} disabled={fetcher.state !== "idle"} onClick={() => update(record.id, nextStatus)}>{label}로 변경</Button>)}
            </InlineStack>
          </BlockStack>
        </Card>;
      })}
      <InlineStack gap="200">
        <Button onClick={() => setSearch({ status })}>첫 페이지</Button>
        {nextCursor && <Button onClick={() => setSearch({ status, cursor: nextCursor })}>다음 페이지</Button>}
      </InlineStack>
    </BlockStack>
  </Page>;
}
