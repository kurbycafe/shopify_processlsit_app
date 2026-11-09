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
