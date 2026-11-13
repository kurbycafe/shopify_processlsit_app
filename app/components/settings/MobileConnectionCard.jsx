import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Card, BlockStack, InlineStack, Text, Button, TextField, Banner, DataTable, Badge, Box, Divider } from '@shopify/polaris';

const HEALTH_STATUS_META = {
 OK: { tone: 'success', label: '정상', bannerTone: 'success' },
 WARN: { tone: 'warning', label: '주의', bannerTone: 'warning' },
 ERROR: { tone: 'critical', label: '오류', bannerTone: 'critical' },
};

function formatCheckedAt(isoString) {
 if (!isoString) return '-';
 const date = new Date(isoString);
 if (Number.isNaN(date.getTime())) return String(isoString);
 return date.toLocaleString('ko-KR');
}

export default function MobileConnectionCard({ baseUrl, configured, nativeOriginsReady, initialHealthResult = null }) {
 const healthFetcher = useFetcher();
 const isChecking = healthFetcher.state === 'submitting' || healthFetcher.state === 'loading';
 const fetcherResult = healthFetcher.data?.intent === 'test_mobile_connection' ? healthFetcher.data : null;
 const healthResult = fetcherResult?.mobileHealth || initialHealthResult;
 const healthError = fetcherResult?.error || null;
 const runHealthCheck = () => {
  if (isChecking) return;
  healthFetcher.submit({ intent: 'test_mobile_connection' }, { method: 'POST' });
 };
 const overallMeta = healthResult ? (HEALTH_STATUS_META[healthResult.overallStatus] || HEALTH_STATUS_META.ERROR) : null;
 const healthRows = (healthResult?.checks || []).map((check) => {
  const meta = HEALTH_STATUS_META[check.status] || HEALTH_STATUS_META.ERROR;
  const timingLabel = [
   check.httpStatus ? `HTTP ${check.httpStatus}` : null,
   typeof check.latencyMs === 'number' ? `${check.latencyMs}ms` : null,
  ].filter(Boolean).join(' · ') || '-';
  return [
   check.label,
   check.endpoint,
   <Badge key={`health-badge-${check.key}`} tone={meta.tone}>{meta.label}</Badge>,
   timingLabel,
   check.detail,
  ];
 });
 const [feedback, setFeedback] = useState(null);
 const config = `VITE_PROCESSLIST_API_URL=${baseUrl}`;
 const example = `const response = await fetch("${baseUrl}/api/customer/v1/orders?limit=10", {\n  headers: { Authorization: \`Bearer \${customerAccessToken}\` }\n});\nconst result = await response.json();\nif (!response.ok || !result.success) throw new Error(result.error?.code || "REQUEST_FAILED");\nconst { orders, pageInfo } = result.data;`;
 const copy = async text => { try { await navigator.clipboard.writeText(text); setFeedback({ tone: 'success', message: '복사했습니다.' }); } catch { setFeedback({ tone: 'warning', message: '복사하지 못했습니다. 아래 내용을 직접 선택해서 복사해 주세요.' }); } };
 return <Card><BlockStack gap="400">
  <InlineStack align="space-between" blockAlign="center" wrap gap="200"><Text as="h2" variant="headingMd">모바일 앱 연결 · 고객용 REST API</Text><Badge tone={configured && nativeOriginsReady ? 'success' : 'attention'}>{configured && nativeOriginsReady ? '필수 설정 확인됨' : '서버 설정 확인 필요'}</Badge></InlineStack>
  <Text as="p">dawayo-mobile-app은 아래 기본 주소 하나를 설정하면 됩니다. 내 주문과 검수 내역에는 Shopify 고객 로그인 토큰을 사용합니다.</Text>
  {!configured && <Banner tone="warning"><p>CUSTOMER_API_SHOP과 CUSTOMER_ACCOUNT_API_URL을 서버에서 확인해 주세요. 현재 Shopify 스토어와 고객 API 스토어가 일치해야 합니다.</p></Banner>}
  {!nativeOriginsReady && <Banner tone="warning"><p>CUSTOMER_API_ALLOWED_ORIGINS에 capacitor://localhost와 https://localhost가 필요합니다.</p></Banner>}
  <TextField label="모바일 앱 기본 주소" value={baseUrl} readOnly autoComplete="off" connectedRight={<Button onClick={() => copy(baseUrl)}>주소 복사</Button>} />
  <TextField label="모바일 .env 설정" value={config} multiline={2} readOnly autoComplete="off" />
  <InlineStack gap="200" wrap>
   <Button variant="primary" loading={isChecking} disabled={isChecking} onClick={runHealthCheck}>
    {isChecking ? '연결 상태 점검 중...' : '실시간 API 연결 점검'}
   </Button>
   <Button onClick={() => copy(config)}>환경 설정 복사</Button>
   <Button onClick={() => copy(example)}>주문 조회 예제 복사</Button>
  </InlineStack>
  {healthError && (
   <Banner tone="critical">
    <Text as="p" variant="bodySm"><strong>실시간 점검 실패:</strong> {healthError}</Text>
   </Banner>
  )}
  {healthResult && overallMeta && (
   <Box padding="300" background="bg-surface-secondary" borderRadius="200" borderWidth="025" borderColor="border">
    <BlockStack gap="300">
     <Banner tone={overallMeta.bannerTone}>
      <InlineStack align="space-between" blockAlign="center" wrap gap="200">
       <Text as="p" variant="bodySm" fontWeight="semibold">
        {healthResult.overallStatus === 'OK'
         ? `실시간 연결 정상 (${healthResult.summary.ok}/${healthResult.summary.total}개 항목 통과 · 총 ${healthResult.totalLatencyMs}ms)`
         : healthResult.overallStatus === 'WARN'
          ? `일부 항목 주의 필요 (정상 ${healthResult.summary.ok}, 주의 ${healthResult.summary.warn}, 오류 ${healthResult.summary.error} · 총 ${healthResult.totalLatencyMs}ms)`
          : `API 연결 오류 감지 (정상 ${healthResult.summary.ok}, 주의 ${healthResult.summary.warn}, 오류 ${healthResult.summary.error} · 총 ${healthResult.totalLatencyMs}ms)`}
       </Text>
       <Text as="span" variant="bodyXs" tone="subdued">
        점검 시각: {formatCheckedAt(healthResult.checkedAt)}
       </Text>
      </InlineStack>
     </Banner>
     <Divider />
     <DataTable
      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
      headings={['점검 항목', '대상 엔드포인트', '상태', 'HTTP · 지연', '점검 상세']}
      rows={healthRows}
     />
    </BlockStack>
   </Box>
  )}
  {feedback && <Banner tone={feedback.tone} onDismiss={() => setFeedback(null)}><p>{feedback.message}</p></Banner>}
  <DataTable columnContentTypes={['text','text','text']} headings={['기능','경로','인증']} rows={[
    ['내 주문', 'GET /api/customer/v1/orders', '고객 Bearer 토큰'],
    ['주문 상품 추가 페이지', 'GET /api/customer/v1/order-items', '고객 Bearer 토큰'],
    ['내 주문 검수', 'GET /api/customer/v1/order-inspection', '고객 Bearer 토큰'],
    ['공지', 'GET /api/customer/v1/notice', '불필요'],
    ['입고 예정', 'GET /api/customer/v1/restock', '불필요'],
    ['재입고 알림 신청', 'POST /api/customer/v1/restock-subscription', '불필요'],
  ]} />
  <TextField label="고객 토큰을 사용하는 주문 조회 예제" value={example} multiline={8} readOnly autoComplete="off" />
  <Text as="p" tone="subdued">Shopify Admin 키, Odoo 키, 직원용 integration-token은 모바일 앱에 넣지 않습니다. orders의 pageInfo.hasNextPage가 true이면 endCursor를 cursor로 보내 다음 페이지를 요청하세요. 401은 재로그인 또는 토큰 갱신이 필요합니다. 이 표시는 환경 설정 확인 결과이며 실제 고객 로그인 통신 테스트 결과는 아닙니다.</Text>
 </BlockStack></Card>;
}
