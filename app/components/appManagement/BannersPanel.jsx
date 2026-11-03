import { AdminListRow, BANNER_GRADIENT_PRESETS } from "./shared.jsx";
import BannerImageUploader from "../BannerImageUploader.jsx";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";

// "banners" tab of the app management screen (moved out of app.app-management.jsx).
export function BannersPanel({
  activeTab,
  bannerForm,
  config,
  editingBanner,
  fetcher,
  handleEditBanner,
  isSubmitting,
  setBannerForm,
  setEditingBanner,
}) {
  return (
    <div style={{ display: activeTab === "banners" ? "block" : "none" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: "20px",
          alignItems: "start",
        }}
      >
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h2">
                등록된 홈 배너 목록 ({config.banners?.length || 0}건)
              </Text>
              <Button
                onClick={() => {
                  setEditingBanner(null);
                  setBannerForm({
                    bannerId: "",
                    sortOrder: String((config.banners?.length || 0) + 1),
                    isActive: true,
                    tagKo: "주간 기획전",
                    tagDe: "AKTION",
                    tagEn: "SPECIAL",
                    titleKo: "",
                    titleDe: "",
                    titleEn: "",
                    subKo: "",
                    subDe: "",
                    subEn: "",
                    badgeKo: "특가",
                    badgeDe: "DEAL",
                    badgeEn: "DEAL",
                    ctaKo: "자세히 보기",
                    ctaDe: "Mehr erfahren",
                    ctaEn: "View More",
                    linkType: "TAB",
                    linkValue: "deals",
                    imageUrl: "",
                    bgGradient:
                      "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
                  });
                }}
              >
                새 배너 추가
              </Button>
            </InlineStack>
            <Divider />

            <BlockStack gap="300">
              {(config.banners || []).map((b, idx) => {
                const submit = (fields) => {
                  const fd = new FormData();
                  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
                  fetcher.submit(fd, { method: "post" });
                };
                return (
                  <AdminListRow
                    key={b.id}
                    thumb={b.image}
                    thumbBackground={b.bgGradient}
                    active={b.isActive}
                    selected={editingBanner === b.id}
                    badges={[
                      {
                        label: b.isActive
                          ? `${b.sortOrder}번 · 노출 중`
                          : "숨김",
                        tone: b.isActive ? "success" : undefined,
                      },
                      ...(b.tag?.ko ? [{ label: b.tag.ko }] : []),
                    ]}
                    title={b.title?.ko || "제목 없음"}
                    subtitle={b.sub?.ko}
                    isFirst={idx === 0}
                    isLast={idx === (config.banners || []).length - 1}
                    onMove={(direction) =>
                      submit({
                        intent: "reorder_banner",
                        bannerId: b.id,
                        direction,
                      })
                    }
                    actions={[
                      { label: "수정", onClick: () => handleEditBanner(b) },
                      {
                        label: b.isActive ? "숨기기" : "노출",
                        onClick: () =>
                          submit({
                            intent: "toggle_banner",
                            bannerId: b.id,
                            isActive: String(!b.isActive),
                          }),
                      },
                      {
                        label: "삭제",
                        tone: "critical",
                        confirm: `'${b.title?.ko || "이 배너"}' 배너를 삭제할까요?`,
                        onClick: () =>
                          submit({ intent: "delete_banner", bannerId: b.id }),
                      },
                    ]}
                  />
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Banner Editor Form */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              {bannerForm.bannerId ? "배너 상세 수정" : "새 홈 배너 등록"}
            </Text>
            <Divider />

            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="노출 순서 (작을수록 먼저 노출)"
                  type="number"
                  value={bannerForm.sortOrder}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, sortOrder: v })
                  }
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1, paddingTop: "24px" }}>
                <Checkbox
                  label="모바일 앱 즉시 노출 (Active)"
                  checked={bannerForm.isActive}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, isActive: v })
                  }
                />
              </div>
            </InlineStack>

            <TextField
              label="메인 헤드라인 (한국어 필수)"
              value={bannerForm.titleKo}
              onChange={(v) => setBannerForm({ ...bannerForm, titleKo: v })}
              placeholder="예: 인기 라면 & 간편식 최대 30% 특가"
              autoComplete="off"
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="헤드라인 (독일어 - 미입력시 한국어 자동적용)"
                  value={bannerForm.titleDe}
                  onChange={(v) => setBannerForm({ ...bannerForm, titleDe: v })}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="헤드라인 (영어 - 선택)"
                  value={bannerForm.titleEn}
                  onChange={(v) => setBannerForm({ ...bannerForm, titleEn: v })}
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <TextField
              label="서브 설명 문구 (한국어)"
              value={bannerForm.subKo}
              onChange={(v) => setBannerForm({ ...bannerForm, subKo: v })}
              placeholder="예: 신라면, 불닭, 햇반 등 베스트셀러 바로 주문"
              autoComplete="off"
            />

            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="상단 태그 (한국어)"
                  value={bannerForm.tagKo}
                  onChange={(v) => setBannerForm({ ...bannerForm, tagKo: v })}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="강조 뱃지 (한국어)"
                  value={bannerForm.badgeKo}
                  onChange={(v) => setBannerForm({ ...bannerForm, badgeKo: v })}
                  placeholder="예: 최대 30%"
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="버튼 문구 (CTA)"
                  value={bannerForm.ctaKo}
                  onChange={(v) => setBannerForm({ ...bannerForm, ctaKo: v })}
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <BannerImageUploader
              imageUrl={bannerForm.imageUrl}
              onChange={(v) => setBannerForm({ ...bannerForm, imageUrl: v })}
              bgGradient={bannerForm.bgGradient}
              titleKo={bannerForm.titleKo}
              tagKo={bannerForm.tagKo}
              ctaKo={bannerForm.ctaKo}
            />

            <Select
              label="배경 그라디언트 테마"
              options={BANNER_GRADIENT_PRESETS.map((p) => ({
                label: p.label,
                value: p.value,
              }))}
              value={bannerForm.bgGradient}
              onChange={(v) => setBannerForm({ ...bannerForm, bgGradient: v })}
            />

            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <Select
                  label="클릭 시 이동 유형"
                  options={[
                    { label: "앱 내 탭 이동 (TAB)", value: "TAB" },
                    { label: "카테고리 필터 (CATEGORY)", value: "CATEGORY" },
                    { label: "외부/상세 URL (URL)", value: "URL" },
                  ]}
                  value={bannerForm.linkType}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, linkType: v })
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="이동 대상 값 (예: deals, arrivals, recipe)"
                  value={bannerForm.linkValue}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, linkValue: v })
                  }
                  autoComplete="off"
                />
              </div>
            </InlineStack>

            <Button
              variant="primary"
              loading={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "save_banner");
                Object.entries(bannerForm).forEach(([k, val]) => {
                  fd.append(k, String(val));
                });
                fetcher.submit(fd, { method: "post" });
              }}
            >
              {bannerForm.bannerId
                ? "배너 변경사항 저장 및 앱 반영"
                : "새 배너 저장 및 앱 반영"}
            </Button>
          </BlockStack>
        </Card>
      </div>
    </div>
  );
}
