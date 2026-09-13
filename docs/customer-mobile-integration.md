# 고객용 Dawayo 모바일 연결

## 고객에게 추가되는 기능

- 내 주문 → 상세: 검수 대기 / 상품 확인 중 / 검수 완료 / 추가 확인 중, 상품별 주문 수량과 확인 수량, 대체 상품 안내, 최근 업데이트 시각.
- 홈: Processlist에서 활성화한 스토어 공지. 공지가 없거나 비활성 상태이면 숨김.
- 품절 상품 상세: Odoo의 실제 미입고 상품 이동에서 재입고 예정일을 확인한다. 미래 일정 / 입고 일정 재확인 / 일정 없음 / 오류 / 로딩을 구분한다.

검수 완료와 발송 완료는 구분한다. 환불/크레딧 이슈 기록은 지급 완료로 표시하지 않는다. 검수 내역이 없는 주문에 완료 표시나 가짜 검수 항목을 만들지 않는다. 작업자 이름, 작업 메모, 바코드, 고객 주소, 공급사, PO 번호, 입고 수량과 매입가는 고객 응답에서 제외된다. 고객 문의/환불 실행/푸시 알림 발송은 이번 범위에 포함하지 않는다.

## 인증 흐름

모바일의 기존 Shopify Customer Account OAuth 로그인 토큰을 `Authorization: Bearer <customer-access-token>`으로 보낸다. 모바일에 직원 API 토큰이나 Shopify Admin/Odoo 키를 추가하지 않는다.

Processlist는 서버에 고정된 Customer Account API에 고객 토큰을 전달한다. 주문 목록과 상세 상품은 로그인한 고객의 `customer.orders`에서 조회하고, 검수도 같은 목록에서 정확한 Order ID가 확인된 뒤에만 DB를 읽는다. 검수 DB는 해당 상점과 Order ID로 제한한다. Admin API의 과거 주문 접근 권한에 의존하지 않으며, 다른 고객의 주문/존재하지 않는 주문은 모두 404다. 매 페이지마다 재확인하고 응답은 `private, no-store`다.

REST API가 401을 반환하면 현재 계정의 refresh token으로 한 번 갱신한 뒤 다시 요청한다. 동시 갱신은 합치며, 로그아웃/계정 전환 후 이전 응답은 반영하지 않는다. 갱신도 실패하면 검수 패널에 재로그인 버튼이 표시된다. 이번 기능은 Customer Account OAuth 토큰을 지원하며, 구형 Storefront customerAccessToken은 직원 권한으로 대체하지 않는다.

## Vercel 환경변수

| 변수 | 값 |
| --- | --- |
| `CUSTOMER_API_SHOP` | 설치된 상점의 정확한 `*.myshopify.com` 도메인. 검수/공지/컨테이너 DB의 shop과 일치해야 함. |
| `CUSTOMER_ACCOUNT_API_URL` | Shopify Customer Account의 실제 GraphQL URL. 예: `https://shopify.com/99898655049/account/customer/api/2026-07/graphql` 또는 `https://실제상점.myshopify.com/customer/api/2026-07/graphql`. 모바일의 discovery 결과와 맞춰 설정. |
| `CUSTOMER_API_ALLOWED_ORIGINS` | 예: `capacitor://localhost,https://localhost,http://localhost:5173,https://모바일웹호스트`. 실제 Capacitor/웹 origin만 허용. |

기존 Shopify/Prisma/Odoo 환경변수는 유지한다. `ODOO_API_KEY`를 서버에 설정해야 ERP 동기화가 동작한다. 이전에 하드코딩된 키는 Odoo에서 교체해야 한다. 공개 상품 여부와 SKU 확인에는 Shopify offline 세션과 상품 조회 권한이 필요하다. 주문/검수는 Customer Account API 권한으로 조회하며 실패를 빈 주문 목록이나 검수 대기로 표시하지 않는다.

환경변수만 저장하지 말고 Vercel 재배포까지 해야 적용된다. 2026-09-12 운영 배포를 완료했다. 운영 주소는 `https://process-list-beryl.vercel.app`다.

## 모바일 환경변수

`/Users/kgt/dawayo-mobile-app/.env` 또는 모바일 빌드 환경에 아래 공개 URL만 추가한다.

```dotenv
VITE_PROCESSLIST_API_URL=https://process-list-beryl.vercel.app
```

Processlist 서버 배포/설정 후 이 값을 설정하고 모바일을 빌드한다. 미설정이면 신규 패널은 숨겨져 기존 쇼핑 기능에 영향을 주지 않는다. `VITE_*` 변수에 API 비밀키/직원 토큰을 넣지 않는다. 실제 `.env`의 다른 값은 수정하지 않았다.

## REST 계약

기본 주소 `/api/customer/v1`

| 요청 | 로그인 | 응답 |
| --- | --- | --- |
| `GET /order-inspection?orderId=gid%3A%2F%2Fshopify%2FOrder%2F123&limit=50` | 고객 OAuth Bearer | `status`, `cancelled`, `fulfillmentStatus`, `checkedAt`, `updatedAt`, `totalItems`, `items`, `pagination` |
| `GET /orders?limit=10&cursor=...` | 고객 OAuth Bearer | 최신 주문, 결제/배송 상태, 상품 20개, 검수 상태, 주문 커서 |
| `GET /order-items?orderId=123&limit=50&cursor=...` | 고객 OAuth Bearer | 해당 고객 주문의 추가 상품과 커서 |
| `GET /notice` | 불필요 | 활성 공지 객체 또는 null |
| `GET /restock?variantId=gid%3A%2F%2Fshopify%2FProductVariant%2F123` | 불필요 | `variantId`, `estimatedDate`, `updatedAt`, `isEstimate` |

검수 상품은 `limit` 1–100, `cursor`로 페이지 조회. 다음 페이지를 읽는 동안 검수 데이터가 갱신되면 모바일이 첫 페이지를 다시 읽는다. 검수 API는 Shopify의 정식 Order GID 또는 숫자 ID를 사용한다. `#1001` 같은 표시용 주문 이름은 받지 않는다.

응답: `{success:true,data:...,meta:{requestId,version:"v1"}}`.
오류: `{success:false,error:{code,message},meta:{requestId,version:"v1"}}`.
400 입력 오류, 401 재로그인 필요, 403 origin 거부, 404 본인 주문/공개 상품 없음, 405 쓰기 거부, 502 upstream 장애, 503 서버 설정 누락.

재입고 정보는 공개 온라인 상품만 조회 가능하며 서버에서 SKU를 확인한다. Odoo `stock.move` 중 incoming이면서 assigned/confirmed/waiting인 이동만 조회한다. date_deadline을 우선하며 deadline이 없을 때 date를 사용한다. 과거 일정은 예정일로 노출하지 않고 미입고 이동이 남아 있으면 `DATE_CONFIRMATION_REQUIRED`를 반환한다. 완료된 상품 이동과 구매 발주 전체 수량을 미입고 수량으로 혼동하지 않는다. 성공 응답은 서버 메모리에 최대 500개 SKU·15분 캐시하며, 같은 SKU의 동시 요청을 합친다. Odoo 장애는 일정 없음으로 캐시하지 않는다. 컨테이너 목록도 완료된 입고를 제외해 실제 미입고만 보여준다.

## 기존 운영 API 변경 주의

기존 `/api/inspection-history`와 `/api/container`도 이제 직원/서버용 Bearer 인증을 요구한다. 기존 무인증 접근을 남겨 두면 고객 전용 API의 보호가 무의미하므로 함께 차단했다.

- 검수 GET: `inspections:read`, POST/PUT: `inspections:write`.
- 컨테이너 GET: `containers:read`, POST: `containers:write`.
- 토큰 등록/생성: `docs/mobile-api.md`, `scripts/create-mobile-token.js` 참조.
- 컨테이너 연동 상점은 `MOBILE_API_ODOO_SHOP`과 일치해야 한다.
- 요청 본문/헤더의 shop으로 토큰 소유 상점을 변경할 수 없다.
- 기존 외부 연동 호출자도 배포 전에 개별 토큰을 발급받아야 한다. 고객 앱에는 이 토큰을 주지 않는다.
- `dawayo.de` 등의 별칭으로 저장된 과거 레코드는 임의로 합치지 않았다. 소유 상점을 확인한 후 canonical domain으로 데이터 이관해야 표시된다.

## 검증

서버: `node --test tests/customer-api.test.js tests/mobile-api.test.js`, `npm run typecheck`, `npm run build`.
모바일: `node --test tests/processlist-client.test.mjs tests/resource-poller.test.mjs tests/customer-session-refresh.test.mjs`, `npm run lint`, `npm run build`.

배포 후 두 고객 계정으로 본인 주문 성공 / 다른 고객 주문 404 / 로그아웃 401을 확인한다. 검수 미등록·완료·부분·이슈·취소, 50개 이상 항목, 네트워크 오류와 재시도도 확인한다. 홈 공지 비활성 상태와 품절 상품의 날짜 유무를 확인한다. 운영 계정/실데이터 검증과 앱스토어/APK 배포는 별도다.

Shopify references: [Customer Account API](https://shopify.dev/docs/api/customer/latest), [Customer query](https://shopify.dev/docs/api/customer/latest/queries/customer), [Offline Admin session](https://shopify.dev/docs/api/shopify-app-react-router/latest/unauthenticated/unauthenticated-admin).

## 자동 갱신과 운영 확인 (2026-09-12)

검수 화면은 30초, 품절 상품 재입고 안내는 2분, 홈 공지는 5분 간격으로 조회한다. 화면이 백그라운드로 이동하면 요청을 중지하고 앱 복귀/연결 복구 시 바로 다시 조회한다. 동시 요청을 막고 일시 오류는 지수 간격으로 재시도한다. 기존 데이터와 마지막 확인 시간을 유지하되, 401/403/404에는 이전 고객 데이터를 지운다. 검수 상품의 다른 페이지에서 기록 버전이 바뀌면 첫 페이지로 돌아간다.

운영 DB의 Container/ContainerItem 테이블 누락(P2021)을 확인하여 기존 Prisma 모델과 일치하는 테이블/인덱스를 추가했다. `scripts/prepare-customer-schema.js`가 Vercel 빌드에서 트랜잭션/잠금으로 멱등 실행된다. 기존 테이블/행 삭제, 재고 변경, 주문 수정은 하지 않는다. 이 보완은 테이블 준비이며 Odoo의 전체 데이터를 자동 수입하지 않는다. 이후 실제 운영 데이터 확인에 따라 고객 재입고 조회는 Odoo 상품 이동을 직접 확인하는 방식으로 보완했다.

실제 배포에서 공지 200, 공개 상품 재입고 200, 비로그인/잘못된 고객 토큰 401, Capacitor CORS를 확인했다. 실제 고객 두 계정의 본인/타인 주문 검증과 앱스토어 배포는 아직 하지 않았다. 직원용 MOBILE_API_CLIENTS 토큰은 발급하지 않았으므로 기존 운영 API를 사용하는 외부 서버는 별도 토큰 등록이 필요하다.

## 주문 조회 수정 및 실제 데이터 확인

2026-09-12 확인: 검수 4,285건(완료 1,542 / 대기 2,439 / 부분 124 / 이슈 180), 모두 canonical 상점에 저장되어 있었다. 컨테이너 DB는 비어 있었으나 Odoo에는 미입고 6건이 존재했고 모두 과거 예정일이었다. 따라서 고객 입고 조회는 빈 컨테이너 테이블 대신 실제 Odoo 상품 이동을 사용하도록 수정했다.

모바일 Customer Account 요청은 raw access token을 Authorization에 보내도록 수정했다. Customer Order의 올바른 필드는 subtotal/totalShipping이며, Storefront의 subtotalPrice/totalShippingPrice를 그대로 요청하던 오류를 수정했다. OAuth 토큰 길이로 API를 추측하지 않는다. 주문 API 오류는 주문 없음과 구분하며, 인증 만료 시 다시 로그인할 수 있다. 목록에 검수 상태를 표시하고 상세에서 전체 검수 상품과 추가 주문 상품을 조회할 수 있다. 상품을 모두 읽기 전 PDF 생성은 막는다.

회귀 테스트: 서버 `node --test tests/customer-api.test.js tests/customer-orders.test.js tests/mobile-api.test.js tests/odoo-restock.test.js`; 모바일 `node --experimental-vm-modules --test tests/shopify-order-contract.test.mjs tests/processlist-client.test.mjs tests/customer-session-refresh.test.mjs tests/resource-poller.test.mjs`. 실제 고객 로그인 성공 경로는 아직 실기기 확인이 필요하다.

## 재입고 알림 신청

`POST /api/customer/v1/restock-subscription`

```json
{"variantId":"gid://shopify/ProductVariant/123","email":"customer@example.com"}
```

Content-Type: application/json. 성공 응답의 data는 `{ "accepted": true }`이다. 고객·Admin·Odoo 키를 보내지 않는다. 서버가 고정된 shop에서 공개 상품 정보를 조회하여 기존 BackInStockSubscription에 저장한다. SKU, 상품 제목, shop을 클라이언트가 지정할 수 없다. 이메일은 URL 파라미터에 포함하지 않는다. 신청 완료는 서버 저장 성공을 뜻하며 이메일 발송 완료를 뜻하지 않는다. 기존 신청 여부는 외부에 공개하지 않는다. POST 이외의 요청은 405이며 OPTIONS는 CORS 사전 요청용이다.
