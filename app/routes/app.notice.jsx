import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Divider,
  Badge,
  Checkbox,
  Box,
  Icon,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon, CheckCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_ITEMS = [
  { title: "실시간 ERP 입고 시스템", desc: "입고 예정 상품 관리 및 재고 반영 속도가 향상되었습니다." },
  { title: "품절 상품 재입고 알림", desc: "품절 상품 상세 페이지에서 입고 예정일(ETA) 확인 및 재입고 알림 신청이 가능합니다." },
  { title: "피킹 및 검수 강화", desc: "안전하고 정확한 검수 절차를 거쳐 발송됩니다." }
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let notice = await prisma.storefrontNotice.findUnique({
    where: { shop }
  });

  if (!notice) {
    // 최초 기본 설정 생성
    notice = await prisma.storefrontNotice.create({
      data: {
        shop,
        isActive: true,
        noticeVersion: "v1.3.0",
        badgeTag: "NEW ANNOUNCEMENT",
        title: "다와요(Dawayo) 서비스 안내",
        subtext: "고객님께 더 빠르고 정확한 서비스를 제공하기 위해 시스템이 업데이트되었습니다.",
        itemsJson: DEFAULT_ITEMS
      }
    });
  }

  let items = DEFAULT_ITEMS;
  if (notice.itemsJson) {
    try {
      items = typeof notice.itemsJson === "string" ? JSON.parse(notice.itemsJson) : notice.itemsJson;
    } catch (e) {
      console.warn("Parse itemsJson failed:", e);
    }
  }

  return {
    shop,
    notice: {
      isActive: notice.isActive,
      noticeVersion: notice.noticeVersion,
      badgeTag: notice.badgeTag,
      title: notice.title,
      subtext: notice.subtext,
      items
    }
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const isActive = formData.get("isActive") === "true";
  const noticeVersion = formData.get("noticeVersion") || "v1.0.0";
  const badgeTag = formData.get("badgeTag") || "ANNOUNCEMENT";
  const title = formData.get("title") || "";
  const subtext = formData.get("subtext") || "";
  const itemsJsonStr = formData.get("itemsJson") || "[]";

  let itemsJson = DEFAULT_ITEMS;
  try {
    itemsJson = JSON.parse(itemsJsonStr);
  } catch (e) {
    console.warn("Invalid items JSON:", e);
  }

  await prisma.storefrontNotice.upsert({
    where: { shop },
    update: {
      isActive,
      noticeVersion,
      badgeTag,
      title,
      subtext,
      itemsJson
    },
    create: {
      shop,
      isActive,
      noticeVersion,
      badgeTag,
      title,
      subtext,
      itemsJson
    }
  });

  return { success: true, message: "스토어프론트 팝업 공지 설정이 성공적으로 저장되었습니다." };
};

export default function StorefrontNoticeSettings() {
  const { notice } = useLoaderData();
  const fetcher = useFetcher();

  const [isActive, setIsActive] = useState(notice.isActive);
  const [noticeVersion, setNoticeVersion] = useState(notice.noticeVersion);
  const [badgeTag, setBadgeTag] = useState(notice.badgeTag);
  const [title, setTitle] = useState(notice.title);
  const [subtext, setSubtext] = useState(notice.subtext);
  const [items, setItems] = useState(notice.items || []);

  const handleItemChange = (index, field, value) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleAddItem = () => {
    setItems([...items, { title: "", desc: "" }]);
  };

  const handleRemoveItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const isSaving = fetcher.state === "submitting";

  const handleSave = () => {
    fetcher.submit(
      {
        isActive: String(isActive),
        noticeVersion,
        badgeTag,
        title,
        subtext,
        itemsJson: JSON.stringify(items)
      },
      { method: "post" }
    );
  };

  return (
    <Page
      title="스토어프론트 팝업 공지 관리"
      subtitle="dawayo.de 샵 프론트 메인 화면에 1회만 표시되는 홍보/안내 팝업 텍스트 및 버전을 설정합니다."
      primaryAction={{
        content: "저장하기",
        onAction: handleSave,
        loading: isSaving
      }}
    >
      <BlockStack gap="500">
        {fetcher.data?.message && (
          <Banner tone="success" onDismiss={() => {}}>
            {fetcher.data.message}
          </Banner>
        )}

        <Layout>
          {/* 설정 입력 영역 */}
          <Layout.Section>
            <BlockStack gap="400">
              <Card padding="500">
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">팝업 활성화 및 노출 버전</Text>
                  <Checkbox
                    label="쇼핑몰 프론트(dawayo.de) 팝업 팝업창 활성화"
                    checked={isActive}
                    onChange={(newVal) => setIsActive(newVal)}
                    helpText="체크 해제 시 고객 화면에서 팝업이 노출되지 않습니다."
                  />
                  <TextField
                    label="공지 노출 버전 (Version Key)"
                    value={noticeVersion}
                    onChange={(val) => setNoticeVersion(val)}
                    helpText="새로운 내용으로 업데이트 후 이 버전값(예: v1.4.0)을 변경하면, 이미 팝업을 닫았던 기존 고객에게도 딱 1회 다시 팝업이 노출됩니다."
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <Card padding="500">
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">팝업 헤더 및 기본 문구</Text>
                  <TextField
                    label="상단 뱃지 태그"
                    value={badgeTag}
                    onChange={(val) => setBadgeTag(val)}
                    placeholder="예: NEW ANNOUNCEMENT, 특가 이벤트"
                    autoComplete="off"
                  />
                  <TextField
                    label="팝업 메인 제목"
                    value={title}
                    onChange={(val) => setTitle(val)}
                    placeholder="예: 다와요(Dawayo) 서비스 업데이트 안내"
                    autoComplete="off"
                  />
                  <TextField
                    label="상단 서브 설명글"
                    value={subtext}
                    onChange={(val) => setSubtext(val)}
                    multiline={2}
                    placeholder="고객님께 안내할 요약 설명을 입력하세요."
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <Card padding="500">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">주요 안내 항목 리스트</Text>
                    <Button icon={PlusIcon} onClick={handleAddItem} variant="plain">
                      항목 추가
                    </Button>
                  </InlineStack>

                  {items.map((item, idx) => (
                    <Box key={idx} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text fontWeight="bold">항목 #{idx + 1}</Text>
                          {items.length > 1 && (
                            <Button
                              icon={DeleteIcon}
                              tone="critical"
                              variant="plain"
                              onClick={() => handleRemoveItem(idx)}
                            />
                          )}
                        </InlineStack>
                        <TextField
                          label="항목 제목"
                          value={item.title}
                          onChange={(val) => handleItemChange(idx, "title", val)}
                          placeholder="예: 실시간 ERP 입고 시스템"
                          autoComplete="off"
                        />
                        <TextField
                          label="항목 상세 설명"
                          value={item.desc}
                          onChange={(val) => handleItemChange(idx, "desc", val)}
                          placeholder="예: 재고 반영 속도가 대폭 향상되었습니다."
                          multiline={2}
                          autoComplete="off"
                        />
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* 오른쪽: 실시간 팝업 디자인 미리보기 */}
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">고객 화면 실시간 미리보기</Text>
                <Text variant="bodySm" tone="subdued">
                  dawayo.de 메인화면에 고객이 접속했을 때 실제 팝업이 노출되는 디자인 모형입니다.
                </Text>
                <Divider />

                {/* 팝업 모형 Container */}
                <div style={{
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                  overflow: "hidden",
                  fontFamily: "sans-serif"
                }}>
                  <div style={{
                    background: "linear-gradient(135deg, #e11d48 0%, #be123c 100%)",
                    padding: "16px",
                    color: "#ffffff"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{
                        background: "#ffffff",
                        color: "#e11d48",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: "900"
                      }}>
                        DAWAYO <span style={{ background: "#e11d48", color: "#fff", padding: "1px 3px", borderRadius: "2px", fontSize: "8px" }}>.de</span>
                      </span>
                      <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)" }}>&times;</span>
                    </div>
                    <span style={{
                      background: "rgba(255,255,255,0.2)",
                      border: "1px solid rgba(255,255,255,0.35)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: "bold"
                    }}>
                      {badgeTag || "NEW ANNOUNCEMENT"}
                    </span>
                    <h4 style={{ margin: "6px 0 0 0", fontSize: "16px", fontWeight: "800" }}>
                      {title || "팝업 제목을 입력하세요"}
                    </h4>
                  </div>
                  <div style={{ padding: "14px" }}>
                    <p style={{ fontSize: "12px", color: "#4b5563", margin: "0 0 12px 0", lineHeight: "1.4" }}>
                      {subtext || "설명글을 입력하세요."}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {items.map((it, i) => (
                        <div key={i} style={{ display: "flex", gap: "8px", fontSize: "12px", color: "#1f2937" }}>
                          <span style={{ color: "#e11d48", fontWeight: "bold" }}>✓</span>
                          <div>
                            <strong>{it.title || "항목 제목"}:</strong> {it.desc || "항목 설명"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{
                    padding: "10px 14px",
                    background: "#f9fafb",
                    borderTop: "1px solid #f3f4f6",
                    display: "flex",
                    justifyContent: "flex-end"
                  }}>
                    <div style={{
                      background: "linear-gradient(135deg, #e11d48 0%, #be123c 100%)",
                      color: "#fff",
                      padding: "6px 14px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "bold",
                      width: "100%",
                      textAlign: "center"
                    }}>
                      확인했습니다 (단 1회 노출)
                    </div>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
