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

// "shipping" tab of the app management screen (moved out of app.app-management.jsx).
export function ShippingPanel({
  appUpdateDraft,
  coldChain,
  fetcher,
  freeShippingThreshold,
  hotDealSettings,
  isSubmitting,
  searchKeywordsText,
  setAppUpdateDraft,
  setColdChain,
  setFreeShippingThreshold,
  setSearchKeywordsText,
  setShippingNoticeDe,
  setShippingNoticeEn,
  setShippingNoticeKo,
  setStoreAddress,
  setStoreHours,
  setTickers,
  shippingNoticeDe,
  shippingNoticeEn,
  shippingNoticeKo,
  storeAddress,
  storeHours,
  tickers,
}) {
  const updateAppField = (field, value) =>
    setAppUpdateDraft((prev) => ({ ...prev, [field]: value }));
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            냉장·냉동 장바구니 분리 표시 및 목요일 오후 냉동 발송 마감(Cut-off)
            고지
          </Text>
          <Text variant="bodySm" tone="subdued" as="p">
            독일 내 냉장·냉동 택배가 주말 동안 물류센터에 체류하며 해동되는
            문제를 방지하기 위해, 장바구니에서 상온/냉장/냉동 상품을 자동 분리
            표시하고 마감 시각 전후 안내 문구를 실시간 노출합니다.
          </Text>
          <Divider />

          <Checkbox
            label="장바구니 내 상온 / 냉장 보관 / 냉동 보관 온도대별 상품 분리 그룹핑 활성화"
            checked={Boolean(coldChain.enableTempGrouping)}
            onChange={(v) =>
              setColdChain({ ...coldChain, enableTempGrouping: v })
            }
          />

          <InlineStack gap="300">
            <div style={{ flex: 1 }}>
              <Select
                label="주간 냉장·냉동 발송 마감 요일 (Cut-off Day)"
                options={[
                  { label: "수요일 (Wednesday)", value: "3" },
                  { label: "목요일 (Thursday - 권장)", value: "4" },
                  { label: "금요일 (Friday)", value: "5" },
                ]}
                value={String(coldChain.cutoffDayOfWeek ?? 4)}
                onChange={(v) =>
                  setColdChain({
                    ...coldChain,
                    cutoffDayOfWeek: Number(v),
                  })
                }
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label="발송 마감 시각 (독일 현지 시각 0~23시)"
                type="number"
                value={String(coldChain.cutoffHour ?? 14)}
                onChange={(v) =>
                  setColdChain({
                    ...coldChain,
                    cutoffHour: Number(v || 14),
                  })
                }
                helpText="예: 14 입력 시 목요일 14:00 이후 냉동 주문에 주말 체류 방지 안내가 자동 강조됩니다."
                autoComplete="off"
              />
            </div>
          </InlineStack>

          <TextField
            label="평일 마감 이전 당일 출고 안내 문구 (한국어)"
            value={coldChain.dispatchNoticeKo || ""}
            onChange={(v) =>
              setColdChain({ ...coldChain, dispatchNoticeKo: v })
            }
            autoComplete="off"
          />
          <InlineStack gap="300">
            <div style={{ flex: 1 }}>
              <TextField
                label="평일 당일 출고 문구 (독일어)"
                value={coldChain.dispatchNoticeDe || ""}
                onChange={(v) =>
                  setColdChain({ ...coldChain, dispatchNoticeDe: v })
                }
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label="평일 당일 출고 문구 (영어)"
                value={coldChain.dispatchNoticeEn || ""}
                onChange={(v) =>
                  setColdChain({ ...coldChain, dispatchNoticeEn: v })
                }
                autoComplete="off"
              />
            </div>
          </InlineStack>

          <TextField
            label="목요일 오후 마감(Cut-off) 이후 냉장·냉동 주문 고지 문구 (한국어)"
            value={coldChain.cutoffNoticeKo || ""}
            onChange={(v) => setColdChain({ ...coldChain, cutoffNoticeKo: v })}
            autoComplete="off"
          />
          <InlineStack gap="300">
            <div style={{ flex: 1 }}>
              <TextField
                label="목요일 마감 이후 고지 문구 (독일어)"
                value={coldChain.cutoffNoticeDe || ""}
                onChange={(v) =>
                  setColdChain({ ...coldChain, cutoffNoticeDe: v })
                }
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label="목요일 마감 이후 고지 문구 (영어)"
                value={coldChain.cutoffNoticeEn || ""}
                onChange={(v) =>
                  setColdChain({ ...coldChain, cutoffNoticeEn: v })
                }
                autoComplete="off"
              />
            </div>
          </InlineStack>

          <Divider />
          <Checkbox
            label="장바구니 내 '무료배송 차액 맞춤 소액 상품' 원클릭 추천 슬라이더 노출"
            checked={Boolean(coldChain.enableCartFiller)}
            onChange={(v) =>
              setColdChain({ ...coldChain, enableCartFiller: v })
            }
          />
          <TextField
            label="무료배송 채우기 슬라이더 안내 타이틀 (한국어)"
            value={coldChain.cartFillerTitleKo || ""}
            onChange={(v) =>
              setColdChain({ ...coldChain, cartFillerTitleKo: v })
            }
            autoComplete="off"
          />
          <TextField
            label="무료배송 채우기 슬라이더 안내 타이틀 (Deutsch)"
            value={coldChain.cartFillerTitleDe || ""}
            onChange={(v) =>
              setColdChain({ ...coldChain, cartFillerTitleDe: v })
            }
            autoComplete="off"
          />
          <TextField
            label="무료배송 채우기 슬라이더 안내 타이틀 (English)"
            value={coldChain.cartFillerTitleEn || ""}
            onChange={(v) =>
              setColdChain({ ...coldChain, cartFillerTitleEn: v })
            }
            autoComplete="off"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            무료배송 기준 금액 · 상단 공지 티커 · 인기 검색어 설정
          </Text>
          <Divider />

          <TextField
            label="독일 전역 무료배송 기준 금액 (€ EUR)"
            type="number"
            step="1"
            value={freeShippingThreshold}
            onChange={setFreeShippingThreshold}
            helpText="장바구니 프로그레스바, 특가 탭 및 상단 배송 안내바에 즉시 연동됩니다."
            autoComplete="off"
          />

          <TextField
            label="배송 안내바 메인 문구 (한국어)"
            value={shippingNoticeKo}
            onChange={setShippingNoticeKo}
            autoComplete="off"
          />
          <InlineStack gap="300">
            <div style={{ flex: 1 }}>
              <TextField
                label="배송 안내바 문구 (독일어)"
                value={shippingNoticeDe}
                onChange={setShippingNoticeDe}
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label="배송 안내바 문구 (영어)"
                value={shippingNoticeEn}
                onChange={setShippingNoticeEn}
                autoComplete="off"
              />
            </div>
          </InlineStack>

          <Divider />
          <Text variant="headingSm" as="h3">
            모바일 앱 버전 정책 (Android / iOS)
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label="Google Play 최신 Android 버전 코드"
                value={appUpdateDraft.androidVersionCode}
                onChange={(v) => updateAppField("androidVersionCode", v)}
                type="number"
                min="1"
                helpText="권장 업데이트 기준 버전 코드입니다. 비워두면 미사용입니다."
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label="최소 필수 Android 버전 코드 (강제 업데이트 기준)"
                value={appUpdateDraft.minAndroidVersionCode}
                onChange={(v) => updateAppField("minAndroidVersionCode", v)}
                type="number"
                min="1"
                helpText="이 값보다 낮은 Android 앱에는 강제 업데이트를 안내합니다."
                autoComplete="off"
              />
            </div>
          </InlineStack>
          <TextField
            label="Android 업데이트 링크 (https URL)"
            value={appUpdateDraft.androidUpdateUrl}
            onChange={(v) => updateAppField("androidUpdateUrl", v)}
            placeholder="https://play.google.com/store/apps/details?id=..."
            helpText="Google Play 스토어 또는 배포 APK 안내 URL (선택)"
            autoComplete="off"
          />
          <InlineStack gap="400" wrap>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label="최신 iOS 빌드 번호"
                value={appUpdateDraft.iosBuildNumber}
                onChange={(v) => updateAppField("iosBuildNumber", v)}
                type="number"
                min="1"
                helpText="App Store / TestFlight 최신 iOS 빌드 번호입니다."
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label="최소 필수 iOS 빌드 번호 (강제 업데이트 기준)"
                value={appUpdateDraft.minIosBuildNumber}
                onChange={(v) => updateAppField("minIosBuildNumber", v)}
                type="number"
                min="1"
                helpText="이 값보다 낮은 iOS 앱에는 강제 업데이트를 안내합니다."
                autoComplete="off"
              />
            </div>
          </InlineStack>
          <TextField
            label="iOS 업데이트 링크 (https URL)"
            value={appUpdateDraft.iosUpdateUrl}
            onChange={(v) => updateAppField("iosUpdateUrl", v)}
            placeholder="https://apps.apple.com/..."
            helpText="App Store 또는 TestFlight 업데이트 URL (선택)"
            autoComplete="off"
          />
          <TextField
            label="업데이트 안내 문구 (선택)"
            value={appUpdateDraft.updateMessage}
            onChange={(v) => updateAppField("updateMessage", v)}
            maxLength={300}
            helpText="앱 업데이트 모달에 표시할 안내 메시지 (최대 300자, 선택)"
            autoComplete="off"
          />
          <Divider />
          <TextField
            label="매장 주소"
            value={storeAddress}
            onChange={setStoreAddress}
            maxLength={300}
            helpText="주소를 입력하면 앱의 길찾기에 사용됩니다."
            autoComplete="off"
          />
          <TextField
            label="매장 영업시간"
            value={storeHours}
            onChange={setStoreHours}
            multiline={3}
            maxLength={500}
            helpText="실제 영업시간을 입력하세요. 비우면 미설정으로 표시됩니다."
            autoComplete="off"
          />
          <Divider />
          <TextField
            label="모바일 검색창 추천 인기 검색어 (쉼표로 구분)"
            value={searchKeywordsText}
            onChange={setSearchKeywordsText}
            helpText="모바일 앱 검색 모달 오픈 시 상단 추천 키워드 칩으로 즉시 노출됩니다."
            autoComplete="off"
          />

          <Divider />
          <InlineStack align="space-between">
            <Text variant="headingSm" as="h3">
              상단 롤링 티커 문구 목록
            </Text>
            <Button
              size="slim"
              onClick={() =>
                setTickers([
                  ...tickers,
                  { ko: "신규 안내 문구를 입력하세요", de: "", en: "" },
                ])
              }
            >
              티커 행 추가
            </Button>
          </InlineStack>

          {tickers.map((t, idx) => (
            <InlineStack key={idx} gap="200" align="center">
              <div style={{ flex: 1 }}>
                <TextField
                  label={`티커 ${idx + 1} (한국어)`}
                  labelHidden
                  value={t.ko || ""}
                  onChange={(v) => {
                    const next = [...tickers];
                    next[idx] = { ...next[idx], ko: v };
                    setTickers(next);
                  }}
                  autoComplete="off"
                />
              </div>
              <Button
                size="slim"
                tone="critical"
                onClick={() => setTickers(tickers.filter((_, i) => i !== idx))}
              >
                삭제
              </Button>
            </InlineStack>
          ))}

          <Button
            variant="primary"
            loading={isSubmitting}
            onClick={() => {
              const fd = new FormData();
              fd.append("intent", "save_store_config");
              fd.append("androidVersionCode", appUpdateDraft.androidVersionCode);
              fd.append("minAndroidVersionCode", appUpdateDraft.minAndroidVersionCode);
              fd.append("androidUpdateUrl", appUpdateDraft.androidUpdateUrl);
              fd.append("iosBuildNumber", appUpdateDraft.iosBuildNumber);
              fd.append("minIosBuildNumber", appUpdateDraft.minIosBuildNumber);
              fd.append("iosUpdateUrl", appUpdateDraft.iosUpdateUrl);
              fd.append("updateMessage", appUpdateDraft.updateMessage);
              fd.append("storeAddress", storeAddress);
              fd.append("storeHours", storeHours);
              fd.append("freeShippingThreshold", freeShippingThreshold);
              fd.append("shippingNoticeKo", shippingNoticeKo);
              fd.append("shippingNoticeDe", shippingNoticeDe);
              fd.append("shippingNoticeEn", shippingNoticeEn);
              fd.append("tickersJson", JSON.stringify(tickers));
              fd.append("hotDealSettingsJson", JSON.stringify(hotDealSettings));
              fd.append("coldChainJson", JSON.stringify(coldChain));
              const kwList = searchKeywordsText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              fd.append("searchKeywordsJson", JSON.stringify(kwList));
              fetcher.submit(fd, { method: "post" });
            }}
          >
            콜드체인 마감 · 무료배송 · 검색어 설정 저장 및 앱 즉시 반영
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
