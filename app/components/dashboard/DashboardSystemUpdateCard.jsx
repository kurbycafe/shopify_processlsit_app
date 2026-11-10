import { Card, BlockStack, InlineStack, Text, Badge, Divider } from "@shopify/polaris";

export function DashboardSystemUpdateCard() {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            시스템 업데이트 내역
          </Text>
          <Badge tone="success">v1.6.0 최신버전</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h3">
              11월 10일 모바일 고객 CS 상담함 및 푸시 알림 모니터링 업데이트
            </Text>
            <Text variant="bodySm" tone="subdued">
              2026-11-10
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
              <strong>모바일 고객 CS 상담함 개편:</strong> 상태별 원클릭 필터(답변 필요/확인 중/처리 완료), Shopify 주문 바로가기, 고객 이메일 연결 및 실무 답변 템플릿 6종을 추가했습니다.
            </li>
            <li>
              <strong>모바일 푸시 알림 모니터링:</strong> 발송 시도·성공·실패·대기열 4대 KPI 현황 카드와 전송 실패 건 일괄 재시도 기능을 구축했습니다.
            </li>
            <li>
              <strong>대시보드 실시간 CS 및 푸시 연동:</strong> 답변 대기 고객 문의 및 푸시 발송 실패 건을 실시간 감지하여 대시보드 메트릭 카드, 상단 배너, 작업 바로가기에 즉시 반영했습니다.
            </li>
            <li>
              <strong>검수 생산성 지표 및 차트 정밀화:</strong> 7일간 실제 검수 완료/보고 기준 건수 집계, 성공률·문제 보고율 요약 블록을 추가했습니다.
            </li>
            <li>
              <strong>재입고 수요 관리 및 모바일 연동:</strong> 품절 상품 재입고 신청 건에 대한 모바일 푸시 알림 발송과 운영 UI를 개선했습니다.
            </li>
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
