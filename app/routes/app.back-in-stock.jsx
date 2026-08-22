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
  RefreshIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendBackInStockEmail } from "../utils/emailService";

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

  const cancelledCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "CANCELLED" },
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
    cancelledCount,
    topProducts,
    subscriptions,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const subscriptionId = formData.get("subscriptionId");
  const variantId = formData.get("variantId");

  // 1. 단일 고객 수동 발송
  if (intent === "notify_single" && subscriptionId) {
    const sub = await prisma.backInStockSubscription.findUnique({
      where: { id: String(subscriptionId) },
    });

    if (!sub) {
      return { success: false, error: "신청 내역을 찾을 수 없습니다." };
    }

    try {
      if (sub.email && sub.email.includes("@")) {
        await sendBackInStockEmail({
          email: sub.email,
          productTitle: sub.productTitle,
          variantTitle: sub.variantTitle,
          shopDomain: shop,
        });
      }

      await prisma.backInStockSubscription.update({
        where: { id: sub.id },
        data: {
          status: "NOTIFIED",
          notifiedAt: new Date(),
        },
      });

      return {
        success: true,
        message: `${sub.email} 고객님께 재입고 알림 이메일이 성공적으로 발송되었습니다.`,
      };
    } catch (err) {
      console.error("Single email send error:", err);
      return { success: false, error: `이메일 발송 실패: ${err.message}` };
    }
  }

  // 2. 단일 신청 취소 처리
  if (intent === "cancel_single" && subscriptionId) {
    await prisma.backInStockSubscription.update({
      where: { id: String(subscriptionId) },
      data: {
        status: "CANCELLED",
      },
    });
    return { success: true, message: "알림 신청이 취소 처리되었습니다." };
  }

  // 3. 특정 품목의 모든 대기자 일괄 수동 발송
  if (intent === "notify_variant" && variantId) {
    const pendingList = await prisma.backInStockSubscription.findMany({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    if (pendingList.length === 0) {
      return { success: true, message: "발송 대기 중인 신청자가 없습니다." };
    }

    let sentCount = 0;
    let failCount = 0;

    for (const sub of pendingList) {
      try {
        if (sub.email && sub.email.includes("@")) {
          await sendBackInStockEmail({
            email: sub.email,
            productTitle: sub.productTitle,
            variantTitle: sub.variantTitle,
            shopDomain: shop,
          });
          sentCount++;
        }

        await prisma.backInStockSubscription.update({
          where: { id: sub.id },
          data: {
            status: "NOTIFIED",
            notifiedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Batch send error for ${sub.email}:`, err);
        failCount++;
      }
    }

    return {
      success: true,
      message: `${sentCount}명의 신청자에게 재입고 알림 이메일이 발송되었습니다.${
        failCount > 0 ? ` (실패 ${failCount}건)` : ""
      }`,
    };
  }

  // 4. 실시간 재고 대조 및 입고 상품 대기자 일괄 자동 발송
  if (intent === "scan_and_notify_instock") {
    const pendingList = await prisma.backInStockSubscription.findMany({
      where: {
        shop,
        status: "PENDING",
      },
    });

    if (pendingList.length === 0) {
      return { success: true, message: "현재 재입고 알림을 대기 중인 고객이 없습니다." };
    }

    // Extract unique variant GIDs
    const variantIdMap = new Map();
    pendingList.forEach((sub) => {
      const gid = sub.variantId.startsWith("gid://")
        ? sub.variantId
        : `gid://shopify/ProductVariant/${sub.variantId}`;
      if (!variantIdMap.has(gid)) {
        variantIdMap.set(gid, []);
      }
      variantIdMap.get(gid).push(sub);
    });

    const gids = Array.from(variantIdMap.keys());
    let notifiedSubscribersCount = 0;
    let inStockVariantsCount = 0;

    try {
      const queryResponse = await admin.graphql(
        `#graphql
        query getStockLevels($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              inventoryQuantity
              availableForSale
              product {
                id
                title
                handle
              }
            }
          }
        }`,
        { variables: { ids: gids } }
      );

      const json = await queryResponse.json();
      const nodes = json.data?.nodes || [];

      for (const variant of nodes) {
        if (!variant) continue;
        const isAvailable = variant.availableForSale === true || (variant.inventoryQuantity && variant.inventoryQuantity > 0);

        if (isAvailable) {
          inStockVariantsCount++;
          const matchingSubs = variantIdMap.get(variant.id) || [];
          const productHandle = variant.product?.handle || "";
          const productUrl = productHandle ? `https://${shop}/products/${productHandle}` : `https://${shop}`;

          for (const sub of matchingSubs) {
            try {
              if (sub.email && sub.email.includes("@")) {
                await sendBackInStockEmail({
                  email: sub.email,
                  productTitle: sub.productTitle || variant.product?.title || "상품",
                  variantTitle: sub.variantTitle || variant.title,
                  productUrl: productUrl,
                  shopDomain: shop,
                });
                notifiedSubscribersCount++;
              }

              await prisma.backInStockSubscription.update({
                where: { id: sub.id },
                data: {
                  status: "NOTIFIED",
                  notifiedAt: new Date(),
                },
              });
            } catch (err) {
              console.error(`Automated stock match send error for ${sub.email}:`, err);
            }
          }
        }
      }

      if (inStockVariantsCount === 0) {
        return {
          success: true,
          message: "대기 중인 품목 중 현재 입고된(재고 > 0) 상품이 없습니다.",
        };
      }

      return {
        success: true,
        message: `재고 감지 완료: 입고된 ${inStockVariantsCount}개 품목의 대기 고객 ${notifiedSubscribersCount}명에게 재입고 알림 이메일이 자동 발송되었습니다.`,
      };
    } catch (err) {
      console.error("Scan and notify error:", err);
      return { success: false, error: `재고 조회 중 오류 발생: ${err.message}` };
    }
  }

  return { success: false, error: "알 수 없는 요청입니다." };
};

export default function BackInStockAdmin() {
  const { pendingCount, notifiedCount, cancelledCount, topProducts, subscriptions } = useLoaderData();
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

  const isScanning =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "scan_and_notify_instock";

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
        loading={fetcher.state !== "idle" && fetcher.formData?.get("variantId") === p.variantId}
      >
        이 품목 일괄 발송
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
    sub.channel === "PUSH" ? (
      <Badge tone="interactive" key={`ch-${sub.id}`}>웹 푸시</Badge>
    ) : (
      <Badge tone="info" key={`ch-${sub.id}`}>이메일</Badge>
    ),
    sub.email,
    sub.status === "PENDING" ? (
      <Badge tone="warning" key={`st-${sub.id}`}>
        대기 중
      </Badge>
    ) : sub.status === "NOTIFIED" ? (
      <Badge tone="success" key={`st-${sub.id}`}>
        발송 완료
      </Badge>
    ) : (
      <Badge tone="critical" key={`st-${sub.id}`}>
        신청 취소됨
      </Badge>
    ),
    sub.status === "PENDING" ? (
      <InlineStack gap="150" key={`act-${sub.id}`}>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="notify_single" />
          <input type="hidden" name="subscriptionId" value={sub.id} />
          <Button
            size="micro"
            loading={fetcher.state !== "idle" && fetcher.formData?.get("subscriptionId") === sub.id}
          >
            이메일 발송
          </Button>
        </fetcher.Form>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="cancel_single" />
          <input type="hidden" name="subscriptionId" value={sub.id} />
          <Button size="micro" tone="critical" loading={fetcher.state !== "idle"}>
            신청 취소
          </Button>
        </fetcher.Form>
      </InlineStack>
    ) : (
      <Text variant="bodySm" tone="subdued" key={`date-${sub.id}`}>
        {sub.notifiedAt ? dayjs(sub.notifiedAt).format("MM-DD HH:mm") : "-"}
      </Text>
    ),
  ]);

  return (
    <Page
      title="재입고 알림 신청 관리 (Back-in-Stock)"
      subtitle="품절 상품에 대한 고객의 재입고 알림 신청 내역 및 Brevo 이메일 발송 자동화 시스템입니다."
      primaryAction={{
        content: "실시간 재고 확인 & 입고 상품 대기자 자동 발송",
        icon: RefreshIcon,
        loading: isScanning,
        onAction: () => {
          const formData = new FormData();
          formData.append("intent", "scan_and_notify_instock");
          fetcher.submit(formData, { method: "post" });
        },
      }}
    >
      <BlockStack gap="500">
        {fetcher.data?.message && (
          <Banner tone="success" onDismiss={() => {}}>
            {fetcher.data.message}
          </Banner>
        )}

        {fetcher.data?.error && (
          <Banner tone="critical" onDismiss={() => {}}>
            {fetcher.data.error}
          </Banner>
        )}

        {/* 자동화 안내 배너 */}
        <Banner title="재입고 알림 자동 및 수동 발송 시스템 안내" tone="info">
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">
              1. <strong>실시간 자동 발송</strong>: Shopify 또는 Odoo에서 컨테이너 상품이 입고되어 재고가 1개 이상으로 변경되면 웹훅을 통해 대기 고객에게 이메일이 자동 발송됩니다.<br />
              2. <strong>수동 즉시 발송</strong>: 상단의 <strong>[실시간 재고 확인 &amp; 입고 상품 대기자 자동 발송]</strong> 버튼을 누르거나, 각 품목별 <strong>[이 품목 일괄 발송]</strong>을 눌러 언제든 즉시 이메일을 보낼 수 있습니다.
            </Text>
          </BlockStack>
        </Banner>

        {/* 상단 통계 카드 */}
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
                  입고 시 자동/수동 통보 대상
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
                  Brevo 이메일 발송 완료된 총 수
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

        {/* Top 10 알림 신청 품목 (발주 우선순위) */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  가장 요청이 많은 품목 Top 10 (발주 우선순위)
                </Text>
                <Text variant="bodySm" tone="subdued">
                  컨테이너 입고 후 [이 품목 일괄 발송]을 누르면 해당 품목의 모든 대기자에게 이메일이 발송됩니다.
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

        {/* 최근 알림 신청자 리스트 */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                전체 재입고 알림 신청 내역
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
                      { label: "신청 취소됨", value: "CANCELLED" },
                    ]}
                    value={selectedStatus}
                    onChange={setSelectedStatus}
                  />
                </div>
              </InlineStack>
            </InlineStack>

            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={["신청 일시", "상품명", "수신 채널", "고객 연락처", "상태", "액션"]}
              rows={subscriberRows}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
