import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

// "overview" tab of the app management screen (moved out of app.app-management.jsx).
export function OverviewPanel({
  activeBannerCount,
  activeCategoryCount,
  activeDealCount,
  config,
  groupBuying,
  productOverrideCount,
  setActiveTab,
}) {
  return (
    <BlockStack gap="500">

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Text variant="headingMd" as="h2">
            모바일 앱 구성요소 관리
          </Text>
        </div>
        <Button onClick={() => setActiveTab("preview")}>
          모바일 화면 미리보기 열기
        </Button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: "16px",
        }}
      >
        {/* Card 1: Hero Banner */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                홈 메인 롤링 배너
              </Text>
              <Badge>{`활성 ${activeBannerCount}건`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              앱 최상단 프로모션 슬라이드 배너의 이미지, 3개국어 문구, 배경 색상
              및 이동 경로를 설정합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("banners")}>설정</Button>
          </div>
        </div>

        {/* Card 2: Hot Deals */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                오늘의 특가 및 타임세일
              </Text>
              <Badge>{`진행중 ${activeDealCount}건`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              카운트다운 타이머와 함께 노출되는 주력 할인 상품 및 할인율 표시를
              설정합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("hotdeals")}>설정</Button>
          </div>
        </div>

        {/* Card 3: Categories & Sticky GNB */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                카테고리 및 상단 메뉴
              </Text>
              <Badge>{`노출 ${activeCategoryCount}개`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              상단 고정 탭 순서와 메인 화면 카테고리 아이콘 및 다국어 명칭을
              관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("categories")}>설정</Button>
          </div>
        </div>

        {/* Card 4: Shipping Bar & Tickers */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                무료배송 기준 및 상단 공지
              </Text>
              <Badge>{`기준 €${config.store?.freeShippingThreshold}`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              독일 전역 무료배송 달성 기준 금액(€)과 상단 물류 안내 문구를
              관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("shipping")}>설정</Button>
          </div>
        </div>
      </div>

      {/* Secondary Section: Sub-Pages Configuration */}
      <div style={{ marginTop: "8px" }}>
        <Text variant="headingMd" as="h2">
          주요 화면별 배너 및 안내 설정
        </Text>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: "16px",
        }}
      >
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                상품 온도 · MHD 관리
              </Text>
              <Badge>{`설정됨 ${productOverrideCount}건`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              상품 온도는 사진·재고 목록에서 일괄 관리하고, MHD 날짜와 상품
              속성은 별도 화면에서 관리합니다.
            </Text>
          </div>
          <div>
            <InlineStack gap="200">
              <Button onClick={() => setActiveTab("temperatures")}>
                온도 관리
              </Button>
              <Button onClick={() => setActiveTab("product-rules")}>
                유통기한 관리
              </Button>
            </InlineStack>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                공동구매 · 정기구독
              </Text>
              <Badge>{`캠페인 ${groupBuying.length}건`}</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              특가 탭 공동구매 캠페인 및 정기배송 박스 플랜을 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("campaigns")}>설정</Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                상품 상세 · 장바구니 · 마이페이지
              </Text>
              <Badge>활성</Badge>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              상품 상세 신선 출고 안내 배너, 품절 재입고 알림, 장바구니 아이스팩
              동봉 문구 및 마이페이지 B2B 문의 배너를 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("pages")}>설정</Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <Text variant="headingMd" as="h3">
                고객 문의 · 반품 접수
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              모바일 앱 마이페이지에서 접수된 1:1 고객 문의, 반품/교환 및 클레임
              접수 내역을 확인하고 처리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("customer-requests")}>
              접수 내역 관리
            </Button>
          </div>
        </div>
      </div>

      {/* Embedded Sub-Managers Quick Access Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "16px",
        }}
      >
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ marginBottom: "6px" }}>
              <Text variant="headingMd" as="h3">
                앱 입고 일정
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              Odoo 입고 컨테이너를 선택하여 모바일 앱에 노출할 이번 달 입고
              일정과 미등록 SKU를 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("arrivals")}>
              입고 일정 관리
            </Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ marginBottom: "6px" }}>
              <Text variant="headingMd" as="h3">
                레시피 커머스
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              모바일 앱 커뮤니티 탭에 노출되는 레시피 아티클과 원클릭 장바구니
              담기 연동 상품을 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("recipes")}>레시피 관리</Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ marginBottom: "6px" }}>
              <Text variant="headingMd" as="h3">
                리뷰 관리
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              모바일 앱에서 작성된 상품 구매 후기, 평점 및 포토 리뷰 노출 상태를
              검수하고 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("reviews")}>리뷰 관리</Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ marginBottom: "6px" }}>
              <Text variant="headingMd" as="h3">
                앱 알림 발송
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              모바일 앱 사용자에게 다국어 푸시 알림 캠페인을 작성하여 즉시 또는
              예약 발송합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("push-notifications")}>
              알림 발송 관리
            </Button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ marginBottom: "6px" }}>
              <Text variant="headingMd" as="h3">
                앱 개선 요청
              </Text>
            </div>
            <Text variant="bodyMd" tone="subdued" as="p">
              모바일 앱 기능 추가, 수정 및 버그 오류 개선 요청을 등록하고
              처리 현황을 관리합니다.
            </Text>
          </div>
          <div>
            <Button onClick={() => setActiveTab("app-requests")}>
              요청 내역 관리
            </Button>
          </div>
        </div>
      </div>

      {/* B2B Wholesale Inquiries Card */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: "12px",
          padding: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "6px",
            }}
          >
            <Text variant="headingMd" as="h3">
              B2B 도매 회원 신청
            </Text>
          </div>
          <Text variant="bodyMd" tone="subdued" as="p">
            모바일 앱에서 접수된 B2B 도매 회원 신청 및 사업자 등록 정보를
            확인하고 승인합니다. 승인 시 계정에 b2b 태그가 부여되어 도매
            할인율이 자동 적용됩니다.
          </Text>
        </div>
        <div>
          <Button
            variant="primary"
            onClick={() => setActiveTab("b2b-requests")}
          >
            신청 내역 확인
          </Button>
        </div>
      </div>
    </BlockStack>
  );
}
