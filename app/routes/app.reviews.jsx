import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Badge, Banner, BlockStack, Box, Button, ButtonGroup, Card, EmptyState, InlineStack, Modal, Page, Text, TextField } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { MobileApiError } from "../services/mobileApi.server.js";
import { adminDeleteReview, adminListReviews, adminSetReviewHidden } from "../services/productReviews.server.js";

// Product reviews from the mobile app and dawayo.de in one list, with the
// source shown on each. Hidden reviews disappear from the app and the shop.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const search = new URL(request.url).searchParams;
  const source = ["app", "web"].includes(search.get("source")) ? search.get("source") : "all";
  const visibility = ["public", "hidden"].includes(search.get("visibility")) ? search.get("visibility") : "all";
  const query = (search.get("q") || "").slice(0, 100);
  try {
    const result = await adminListReviews({ db: prisma, shop: session.shop, source, visibility, query, cursor: search.get("cursor") });
    return { ...result, source, visibility, query, error: null };
  } catch {
    return { reviews: [], nextCursor: null, source, visibility, query, error: "리뷰를 불러오지 못했습니다. 다시 시도해주세요." };
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") || "");
  try {
    if (form.get("intent") === "delete") await adminDeleteReview({ db: prisma, shop: session.shop, id });
    else await adminSetReviewHidden({ db: prisma, shop: session.shop, id, hidden: form.get("hidden") === "true" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof MobileApiError ? error.message : "처리하지 못했습니다." };
  }
};

const SOURCE_LABEL = { app: "앱", web: "웹(dawayo.de)" };

function Stars({ rating }) {
  if (!rating) return <Text as="span" tone="subdued">별점 없음</Text>;
  return <span aria-label={`${rating}점`} style={{ color: "#E30613", letterSpacing: 1 }}>{"★".repeat(rating)}<span style={{ color: "#d0d0d0" }}>{"★".repeat(5 - rating)}</span></span>;
}

function ReviewRow({ review, onPhoto, onDelete }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const hidden = fetcher.formData ? fetcher.formData.get("hidden") === "true" : review.hidden;
  return (
    <Box padding="300" borderWidth="025" borderColor="border" borderRadius="300" background={hidden ? "bg-surface-secondary" : "bg-surface"}>
      <InlineStack gap="300" wrap={false} blockAlign="start">
        {review.image
          ? <button type="button" onClick={() => onPhoto(review.image)} style={{ padding: 0, border: 0, background: "transparent", cursor: "zoom-in", flexShrink: 0 }} aria-label="사진 크게 보기"><img src={review.image} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block" }} /></button>
          : <div style={{ width: 72, height: 72, borderRadius: 8, background: "#f1f1f1", flexShrink: 0 }} />}
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={review.source === "web" ? "info" : "magic"}>{SOURCE_LABEL[review.source]}</Badge>
            {hidden && <Badge>숨김</Badge>}
            <Stars rating={review.rating} />
          </InlineStack>
          <Text as="p" fontWeight="semibold">{review.productTitle || review.dishName}</Text>
          <Text as="p"><span style={{ whiteSpace: "pre-line" }}>{review.comment}</span></Text>
          <Text as="p" variant="bodySm" tone="subdued">{review.userName} · {review.date} · 좋아요 {review.likes}</Text>
          {fetcher.data?.ok === false && <Text as="p" tone="critical">{fetcher.data.error}</Text>}
        </BlockStack>
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <ButtonGroup>
            <Button loading={busy} onClick={() => fetcher.submit({ id: review.id, hidden: String(!hidden) }, { method: "post" })}>{hidden ? "다시 공개" : "숨기기"}</Button>
            <Button tone="critical" variant="plain" disabled={busy} onClick={() => onDelete(review)}>삭제</Button>
          </ButtonGroup>
        </div>
      </InlineStack>
    </Box>
  );
}

export default function ReviewsPage() {
  const data = useLoaderData();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(data.query);
  const [photo, setPhoto] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const remover = useFetcher();
  useEffect(() => { if (remover.state === "idle" && remover.data?.ok) setDeleting(null); }, [remover.state, remover.data]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === "all" || !value) next.delete(key); else next.set(key, value);
    next.delete("cursor");
    setParams(next);
  };
  const tab = (key, value, label) => (
    <Button pressed={data[key] === value} onClick={() => setFilter(key, value)}>{label}</Button>
  );

  return (
    <Page title="리뷰 관리" subtitle="앱과 dawayo.de에서 작성된 상품 리뷰를 한곳에서 관리합니다. 숨긴 리뷰는 앱과 웹 모두에서 보이지 않습니다.">
      <BlockStack gap="400">
        {data.error && <Banner tone="critical">{data.error}</Banner>}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <ButtonGroup variant="segmented">{tab("source", "all", "전체")}{tab("source", "app", "앱")}{tab("source", "web", "웹")}</ButtonGroup>
              <ButtonGroup variant="segmented">{tab("visibility", "all", "모두")}{tab("visibility", "public", "공개")}{tab("visibility", "hidden", "숨김")}</ButtonGroup>
            </InlineStack>
            <form onSubmit={(event) => { event.preventDefault(); setFilter("q", query.trim()); }}>
              <TextField label="검색" labelHidden value={query} onChange={setQuery} placeholder="상품명, 작성자, 내용으로 검색" autoComplete="off" connectedRight={<Button submit>검색</Button>} />
            </form>
          </BlockStack>
        </Card>
        <Card>
          {data.reviews.length === 0
            ? <EmptyState heading="표시할 리뷰가 없습니다" image=""><p>조건을 바꾸거나, 앱과 dawayo.de에서 리뷰가 등록되면 여기에 나타납니다.</p></EmptyState>
            : <BlockStack gap="300">
                {data.reviews.map((review) => <ReviewRow key={review.id} review={review} onPhoto={setPhoto} onDelete={setDeleting} />)}
                {data.nextCursor && <InlineStack align="center"><Button onClick={() => { const next = new URLSearchParams(params); next.set("cursor", data.nextCursor); setParams(next); }}>다음 페이지</Button></InlineStack>}
              </BlockStack>}
        </Card>
      </BlockStack>
      <Modal open={Boolean(photo)} onClose={() => setPhoto(null)} title="리뷰 사진" secondaryActions={[{ content: "닫기", onAction: () => setPhoto(null) }]}>
        <Modal.Section>{photo && <img src={photo} alt="리뷰 사진" style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} />}</Modal.Section>
      </Modal>
      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="리뷰를 삭제할까요?"
        primaryAction={{ content: "삭제", destructive: true, loading: remover.state !== "idle", onAction: () => remover.submit({ intent: "delete", id: deleting.id }, { method: "post" }) }}
        secondaryActions={[{ content: "취소", onAction: () => setDeleting(null) }]}>
        <Modal.Section><Text as="p">삭제한 리뷰는 되돌릴 수 없습니다. 잠시 내리기만 하려면 &ldquo;숨기기&rdquo;를 쓰세요.</Text>{remover.data?.ok === false && <Text as="p" tone="critical">{remover.data.error}</Text>}</Modal.Section>
      </Modal>
    </Page>
  );
}
