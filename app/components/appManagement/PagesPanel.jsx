import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  Text,
  TextField,
} from "@shopify/polaris";

// "pages" tab of the app management screen (moved out of app.app-management.jsx).
export function PagesPanel({
  cartPage,
  fetcher,
  freeShippingThreshold,
  isSubmitting,
  myPage,
  productPage,
  setCartPage,
  setMyPage,
  setProductPage,
  shippingNoticeKo,
}) {
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            상품 상세 페이지 (Product Page) 안내 설정
          </Text>
          <Divider />
          <Checkbox
            label="상세페이지 내 '신선 포장 및 바코드 검수 출고' 안심 배너 표시"
            checked={Boolean(productPage.showFreshnessBanner)}
            onChange={(v) =>
              setProductPage({ ...productPage, showFreshnessBanner: v })
            }
          />
          <TextField
            label="상품 상세 안심 배너 문구 (한국어)"
            value={productPage.freshnessBannerKo || ""}
            onChange={(v) =>
              setProductPage({ ...productPage, freshnessBannerKo: v })
            }
            autoComplete="off"
          />
          <Checkbox
            label="품절 상품 '재입고 알림 신청 (Restock ETA)' 버튼 활성화"
            checked={Boolean(productPage.enableRestockAlert)}
            onChange={(v) =>
              setProductPage({ ...productPage, enableRestockAlert: v })
            }
          />
          <Checkbox
            label="상품과 연관된 K-푸드 레시피 자동 추천 노출"
            checked={Boolean(productPage.showRelatedRecipes)}
            onChange={(v) =>
              setProductPage({ ...productPage, showRelatedRecipes: v })
            }
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            장바구니 및 배송 (Cart & Shipping) 설정
          </Text>
          <Divider />
          <Checkbox
            label="장바구니 상단 무료배송 달성 실시간 게이지 바 노출"
            checked={Boolean(cartPage.showFreeShippingBar)}
            onChange={(v) =>
              setCartPage({ ...cartPage, showFreeShippingBar: v })
            }
          />
          <TextField
            label="장바구니 아이스팩 동봉 포장 안내 문구 (한국어)"
            value={cartPage.insulationNoticeKo || ""}
            onChange={(v) =>
              setCartPage({ ...cartPage, insulationNoticeKo: v })
            }
            autoComplete="off"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            마이페이지 (MyPage) 배너 및 고객지원 설정
          </Text>
          <Divider />
          <Checkbox
            label="마이페이지 내 '식당·마트 B2B 대량 구매 문의' 배너 노출"
            checked={Boolean(myPage.showB2bBanner)}
            onChange={(v) => setMyPage({ ...myPage, showB2bBanner: v })}
          />
          <TextField
            label="B2B 안내 배너 타이틀 (한국어)"
            value={myPage.b2bBannerTitleKo || ""}
            onChange={(v) => setMyPage({ ...myPage, b2bBannerTitleKo: v })}
            autoComplete="off"
          />
          <TextField
            label="고객지원 대표 이메일"
            value={myPage.supportEmail || ""}
            onChange={(v) => setMyPage({ ...myPage, supportEmail: v })}
            autoComplete="off"
          />

          <Button
            variant="primary"
            loading={isSubmitting}
            onClick={() => {
              const fd = new FormData();
              fd.append("intent", "save_store_config");
              fd.append("freeShippingThreshold", freeShippingThreshold);
              fd.append("shippingNoticeKo", shippingNoticeKo);
              fd.append(
                "pageSettingsJson",
                JSON.stringify({ productPage, cartPage, myPage }),
              );
              fetcher.submit(fd, { method: "post" });
            }}
          >
            화면별 설정 저장 및 모바일 앱 즉시 반영
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
