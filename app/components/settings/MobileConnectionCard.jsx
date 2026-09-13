import { useState } from 'react';
import { Card, BlockStack, InlineStack, Text, Button, TextField, Banner, DataTable, Badge } from '@shopify/polaris';
export default function MobileConnectionCard({ baseUrl, configured, nativeOriginsReady }) {
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
  <InlineStack gap="200"><Button onClick={() => copy(config)}>환경 설정 복사</Button><Button onClick={() => copy(example)}>주문 조회 예제 복사</Button></InlineStack>
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
