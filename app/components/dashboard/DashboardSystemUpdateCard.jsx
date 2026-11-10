import { Card, BlockStack, InlineStack, Text, Badge, Divider } from "@shopify/polaris";

export function DashboardSystemUpdateCard() {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            시스템 업데이트 내역
          </Text>
          <Badge>v1.6.0</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h3">
              모바일 고객 상담함 및 푸시 알림 관리 개선
            </Text>
            <Text variant="bodySm" tone="subdued">
              2026-11-10
            </Text>
          </InlineStack>

          <ul
            style={{
              paddingLeft: "20px",
              margin: 0,
              fontSize: "13px",
              lineHeight: "1.75",
              color: "#303030",
            }}
          >
            <li>고객 상담함에 상태별 필터(답변 필요·확인 중·처리 완료), Shopify 주문 바로가기, 기본 답변 템플릿 6종을 추가했습니다.</li>
            <li>푸시 알림 관리에 발송 현황 요약(시도·성공·실패·대기열)과 실패 건 일괄 재시도 기능을 추가했습니다.</li>
            <li>대시보드에서 미답변 고객 문의 및 푸시 전송 실패 건수를 바로 확인하고 이동할 수 있습니다.</li>
            <li>최근 7일 검수 현황 차트에 전체 검수 건수와 완료율 요약을 표시합니다.</li>
            <li>품절 상품 재입고 시 모바일 푸시 알림 연동 및 레시피 관리 화면 로딩 오류를 수정했습니다.</li>
          </ul>
        </BlockStack>

        <Divider />

        <details className="ops-update-details">
          <summary>이전 업데이트 내역 보기 · 2026-10-23 (v1.5.0)</summary>
          <div style={{ marginTop: "12px" }}>
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
                  <strong>납품서 조회 및 인쇄 안정화:</strong> 목록 조회 응답 속도를 개선하고 대량 인쇄 시 주문 누락 방지 검증을 추가했습니다.
                </li>
                <li>
                  <strong>피킹 리스트 실시간 검색:</strong> 상품명, 바코드, 창고 위치(레갈 번호) 기준 즉시 필터링을 지원합니다.
                </li>
                <li>
                  <strong>검수 바코드 연속 스캔 지원:</strong> 입력창 초기화 없이 연속 스캔 입력이 처리되도록 개선했습니다.
                </li>
                <li>
                  <strong>목록 필터 상태 유지:</strong> 납품서 상세 조회 후 목록 복귀 시 기존 검색어와 필터 조건이 유지됩니다.
                </li>
                <li>
                  <strong>API 요청 제한 및 세션 관리 개선:</strong> 재입고 알림 신청 API의 중복·과다 호출 제한과 백그라운드 세션 갱신을 적용했습니다.
                </li>
              </ul>
            </BlockStack>
          </div>
        </details>
      </BlockStack>
    </Card>
  );
}
