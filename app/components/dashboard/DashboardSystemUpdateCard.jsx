import { Card, BlockStack, InlineStack, Text, Badge, Divider } from "@shopify/polaris";

/**
 * 시스템 업데이트 내역 단일 안내 카드 (하단 배치용)
 */
export function DashboardSystemUpdateCard() {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            시스템 업데이트 내역
          </Text>
          <Badge tone="info">v1.4.0 최신버전</Badge>
        </InlineStack>

        <Divider />

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

        <Divider />

        <details className="ops-update-details">
          <summary>이전 업데이트 내역 보기 · 2026-08-07 (v1.3.0)</summary>
          <div style={{ marginTop: "12px" }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h3">
                  8월 7일 시스템 업데이트
                </Text>
                <Text variant="bodySm" tone="subdued">
                  2026-08-07
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
                  <strong>주간 단위 검수 모니터링:</strong> 메인 대시보드 검수 메트릭을 주간 단위
                  현황으로 개편하고 검수 이력 조회에 &quot;이번주 (THIS_WEEK)&quot; 필터 옵션을 추가했습니다.
                </li>
                <li>
                  <strong>자사몰 홍보 팝업 모달 연동:</strong> 고객 프론트 화면(dawayo.de) 접속 시 1회성
                  프로모션 팝업을 노출하고, 어드민(고객 팝업 관리)에서 활성화 여부, 버전, 문구 편집
                  기능 및 실시간 미리보기를 구축했습니다.
                </li>
                <li>
                  <strong>B2B 도매 카탈로그 PDF 템플릿 고도화:</strong>
                  <ul style={{ paddingLeft: "18px", marginTop: "4px" }}>
                    <li>
                      DAWAYO 브랜드 로고 적용 및 대기업 B2B 수주 정책 박스(MOQ, 공급가, 콜드체인, B2B
                      접수창구) 탑재
                    </li>
                    <li>
                      Shopify custom.producttype 메타필드 기반 냉동(-18℃) / 냉장(1~5℃) / 실온 보관 방식
                      자동 분류 뱃지 적용
                    </li>
                    <li>
                      대외비 보안 선언문(CONFIDENTIAL & PROPRIETARY) 및 법적 푸터 삽입으로 사내 기밀 정보
                      보호
                    </li>
                  </ul>
                </li>
              </ul>
            </BlockStack>
          </div>
        </details>
      </BlockStack>
    </Card>
  );
}
