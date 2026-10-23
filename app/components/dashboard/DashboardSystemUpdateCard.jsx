import { Card, BlockStack, InlineStack, Text, Badge, Divider } from "@shopify/polaris";

export function DashboardSystemUpdateCard() {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            시스템 업데이트 내역
          </Text>
          <Badge tone="success">v1.5.0 최신버전</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h3">
              10월 23일 시스템 성능 및 물류 최적화 업데이트
            </Text>
            <Text variant="bodySm" tone="subdued">
              2026-10-23
            </Text>
          </InlineStack>

          <ul
            style={{
              paddingLeft: "20px",
              margin: 0,
              fontSize: "13.5px",
              lineHeight: "1.8",
              color: "#334155",
            }}
          >
            <li>
              <strong>납품서 로딩 속도 7배 개선:</strong> 페이지가 0.6초 만에 즉시 열리며, PDF 인쇄 시 멈춤 및 누락 현상을 방지했습니다.
            </li>
            <li>
              <strong>피킹 리스트 실시간 검색 추가:</strong> 상품명, 바코드, 창고 위치(레갈)를 입력하는 즉시 화면에서 바로 찾아냅니다.
            </li>
            <li>
              <strong>바코드 연속 스캔 편의성 향상:</strong> 지우지 않고 바코드기로 연속 스캔해도 오류 없이 바로바로 자동 입력됩니다.
            </li>
            <li>
              <strong>뒤로가기 시 필터 상태 유지:</strong> 납품서 상세를 확인하고 돌아와도 선택했던 필터와 검색어가 그대로 유지됩니다.
            </li>
            <li>
              <strong>시스템 속도 및 서버 안정성 강화:</strong> 화면 전환 렉을 없애고, 쇼핑몰 접속자가 몰려도 서버가 느려지지 않도록 보호했습니다.
            </li>
          </ul>
        </BlockStack>

        <Divider />

        <details className="ops-update-details">
          <summary>이전 업데이트 내역 보기 · 2026-09-14 (v1.4.0)</summary>
          <div style={{ marginTop: "12px" }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h3">
                  9월 14일 시스템 업데이트
                </Text>
                <Text variant="bodySm" tone="subdued">
                  2026-09-14
                </Text>
              </InlineStack>

              <ul
                style={{
                  paddingLeft: "20px",
                  margin: 0,
                  fontSize: "13.5px",
                  lineHeight: "1.8",
                  color: "#334155",
                }}
              >
                <li>
                  <strong>고객 모바일 앱 연동 API:</strong> 주문 내역 조회, 재주문, 배송지 및 프로필 관리, 재입고 알림 전용 API 신설
                </li>
                <li>
                  <strong>주문 취소/변경 실시간 알림:</strong> 고객 취소 및 요청(반품/수정) 실시간 감지 및 담당자 자동 이메일 통보
                </li>
                <li>
                  <strong>대시보드 동선 및 속도 최적화:</strong> 작업 바로가기(피킹/검수) 신설, 병렬 데이터 로딩 및 엑셀 모듈 분리로 속도 개선
                </li>
                <li>
                  <strong>피킹 리스트 및 검수 개선:</strong> 피킹 리스트 인쇄 서식 개편, 바코드 스캔 검수 및 이력 추적 안정화
                </li>
                <li>
                  <strong>컨테이너 입고 관리 안정화:</strong> 동시 처리 방지 락 적용 및 기입고 완료 품목 수량 보존
                </li>
              </ul>
            </BlockStack>
          </div>
        </details>
      </BlockStack>
    </Card>
  );
}
