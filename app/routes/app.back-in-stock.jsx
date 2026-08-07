import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Button,
  Select,
  TextField,
  Banner,
  Icon,
} from "@shopify/polaris";
import {
  NotificationIcon,
  CheckCircleIcon,
  ClockIcon,
  SendIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. 전체 통계
  const pendingCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "PENDING" },
  });

  const notifiedCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "NOTIFIED" },
  });

  // 2. 가장 알림 신청이 많은 품목 Top 10 (주문/발주 참고용)
  const topProductsRaw = await prisma.backInStockSubscription.groupBy({
    by: ["productId", "variantId", "productTitle", "variantTitle", "etaDate"],
    where: { shop, status: "PENDING" },
    _count: {
      id: true,
    },
    orderBy: {
      _count: {
        id: "desc",
      },
    },
    take: 10,
  });

  const topProducts = topProductsRaw.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    productTitle: item.productTitle,
    variantTitle: item.variantTitle,
    etaDate: item.etaDate || "미정",
    count: item._count.id,
  }));

  // 3. 전체 신청자 리스트 (최근 50건)
  const subscriptions = await prisma.backInStockSubscription.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    shop,
    pendingCount,
    notifiedCount,
    topProducts,
    subscriptions,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const subscriptionId = formData.get("subscriptionId");
  const variantId = formData.get("variantId");

  if (intent === "notify_single" && subscriptionId) {
    await prisma.backInStockSubscription.update({
      where: { id: String(subscriptionId) },
      data: {
        status: "NOTIFIED",
        notifiedAt: new Date(),
      },
    });
    return { success: true, message: "알림 발송 처리되었습니다." };
  }

  if (intent === "notify_variant" && variantId) {
    const updated = await prisma.backInStockSubscription.updateMany({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
      data: {
        status: "NOTIFIED",
        notifiedAt: new Date(),
      },
    });
    return { success: true, message: `${updated.count}명의 신청자에게 알림이 발송되었습니다.` };
  }

  return { success: false, error: "알 수 없는 요청입니다." };
};

export default function BackInStockAdmin() {
  const { pendingCount, notifiedCount, topProducts, subscriptions } = useLoaderData();
  const fetcher = useFetcher();

  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesStatus = selectedStatus === "ALL" || sub.status === selectedStatus;
    const matchesQuery =
      searchQuery === "" ||
      sub.productTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesQuery;
  });

  const topProductRows = topProducts.map((p) => [
    <BlockStack key={p.variantId} gap="050">
      <Text variant="bodyMd" fontWeight="bold">
        {p.productTitle}
      </Text>
      {p.variantTitle && (
        <Text variant="bodySm" tone="subdued">
          {p.variantTitle}
        </Text>
      )}
    </BlockStack>,
    <Badge tone="attention" key={`eta-${p.variantId}`}>
      {p.etaDate}
    </Badge>,
    <Badge tone="primary" key={`count-${p.variantId}`}>
      {`${p.count}명`}
    </Badge>,
    <fetcher.Form method="post" key={`act-${p.variantId}`}>
      <input type="hidden" name="intent" value="notify_variant" />
      <input type="hidden" name="variantId" value={p.variantId} />
      <Button
        size="micro"
        icon={SendIcon}
        variant="primary"
        loading={fetcher.state !== "idle"}
      >
        일괄 알림 발송
      </Button>
    </fetcher.Form>,
  ]);

  const subscriberRows = filteredSubscriptions.map((sub) => [
    dayjs(sub.createdAt).format("YYYY-MM-DD HH:mm"),
    <BlockStack key={`p-${sub.id}`} gap="050">
      <Text variant="bodyMd" fontWeight="semibold">
        {sub.productTitle}
      </Text>
      {sub.variantTitle && (
        <Text variant="bodySm" tone="subdued">
          {sub.variantTitle}
        </Text>
      )}
    </BlockStack>,
    sub.email,
    sub.status === "PENDING" ? (
      <Badge tone="warning" key={`st-${sub.id}`}>
        대기 중
      </Badge>
    ) : (
      <Badge tone="success" key={`st-${sub.id}`}>
        발송 완료
      </Badge>
    ),
    sub.status === "PENDING" ? (
      <fetcher.Form method="post" key={`act-${sub.id}`}>
        <input type="hidden" name="intent" value="notify_single" />
        <input type="hidden" name="subscriptionId" value={sub.id} />
        <Button size="micro" loading={fetcher.state !== "idle"}>
          수동 알림 전송
        </Button>
      </fetcher.Form>
    ) : (
      <Text variant="bodySm" tone="subdued" key={`date-${sub.id}`}>
        {sub.notifiedAt ? dayjs(sub.notifiedAt).format("MM-DD HH:mm") : "-"}
      </Text>
    ),
  ]);

  return (
    <Page
      title="재입고 알림 신청 관리 (Back-in-Stock)"
      subtitle="품절 상품에 대한 고객의 재입고 알림 신청 내역 및 발주 우선순위 리포트입니다."
    >
      <BlockStack gap="500">
        {fetcher.data?.message && (
          <Banner tone="success" onDismiss={() => {}}>
            {fetcher.data.message}
          </Banner>
        )}

        <Banner title="🛍️ 쇼핑몰 고객 화면(스토어프론트) 설치 방법" tone="info">
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">
              고객 화면에 재입고 알림 버튼을 표시하려면 쇼피파이 테마에 아래 스크립트를 1줄 추가해 주세요.
            </Text>
            <Text variant="bodySm" as="p" tone="subdued">
              경로: <strong>쇼피파이 어드민 &gt; Online Store &gt; Themes &gt; Edit code &gt; layout/theme.liquid</strong> (<code>&lt;/head&gt;</code> 직전에 추가)
            </Text>
            <pre style={{ background: "#f1f5f9", padding: "10px", borderRadius: "6px", overflowX: "auto", fontSize: "13px" }}>
              {`<script src="https://process-list-beryl.vercel.app/back-in-stock.js" defer></script>`}
            </pre>
          </BlockStack>
        </Banner>

        {/* 📊 상단 통계 카드 */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">
                    알림 대기 고객
                  </Text>
                  <Icon source={ClockIcon} tone="warning" />
                </InlineStack>
                <Text variant="heading2xl" as="p" tone="warning">
                  {`${pendingCount} 명`}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  입고 시 자동/수동 통보 예정
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">
                    알림 발송 완료
                  </Text>
                  <Icon source={CheckCircleIcon} tone="success" />
                </InlineStack>
                <Text variant="heading2xl" as="p" tone="success">
                  {`${notifiedCount} 건`}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  재입고 통보가 완료된 총 수
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">
                    인기 요청 품목 수
                  </Text>
                  <Icon source={NotificationIcon} tone="primary" />
                </InlineStack>
                <Text variant="heading2xl" as="p" tone="primary">
                  {`${topProducts.length} 개`}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  대기자가 존재하는 품목 종류
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* 🏆 Top 10 알림 신청 품목 (발주 우선순위) */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  🔥 가장 요청이 많은 품목 Top 10
                </Text>
                <Text variant="bodySm" tone="subdued">
                  고객 수요가 높은 품목입니다. 컨테이너 입고 시 우선 검수 및 발주에 참고하세요.
                </Text>
              </BlockStack>
            </InlineStack>

            {topProducts.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["상품명", "입고 예정일 (ETA)", "대기 신청자", "액션"]}
                rows={topProductRows}
              />
            ) : (
              <Text variant="bodyMd" tone="subdued">
                현재 대기 중인 재입고 알림 신청이 없습니다.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* 📋 최근 알림 신청자 리스트 */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                📋 전체 재입고 알림 신청 내역
              </Text>
              <InlineStack gap="300">
                <div style={{ width: "200px" }}>
                  <TextField
                    placeholder="상품명 또는 이메일 검색"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                    autoComplete="off"
                  />
                </div>
                <div style={{ width: "150px" }}>
                  <Select
                    options={[
                      { label: "전체 상태", value: "ALL" },
                      { label: "대기 중", value: "PENDING" },
                      { label: "발송 완료", value: "NOTIFIED" },
                    ]}
                    value={selectedStatus}
                    onChange={setSelectedStatus}
                  />
                </div>
              </InlineStack>
            </InlineStack>

            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["신청 일시", "상품명", "고객 이메일", "상태", "액션"]}
              rows={subscriberRows}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
