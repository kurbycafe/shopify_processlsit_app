# 모바일 실포인트 연동 — 2026-10-21

구현: 출석/후기 저장 → 서버의 지급 이력 예약 → Joy REST v2 실제 적립 → Joy 잔액 재조회. 앱은 잔액을 직접 증가시키지 않는다.

## 적용 기준

| 행동 | 기준 | 중복 방지 |
| --- | --- | --- |
| 출석 | 50P | Europe/Berlin 날짜 기준 고객당 하루 한 번 |
| 일반 상품 후기 | 50P | 구매가 확인된 상품당 최초 한 번 |
| 사진 상품 후기 | 100P | 일반 후기와 같은 지급 키. 일반 후기 후 사진을 올려 추가 적립하지 않음 |

기존 앱의 출석 50P, 일반 후기 50P, 사진 후기 100P 기준을 서버 정책으로 이동했다. 제품 ID 없는 일반 커뮤니티 후기는 저장되지만 포인트 적립 대상이 아니다. 취소/미결제/환불된 주문은 구매 확인 대상에서 제외한다. 현재 구매 판정은 financialStatus=PAID, cancelledAt 없음, 상품 일치, 수량>0이다.

과거 버전에는 연속 출석 포인트 보너스(3일 100P/7일 500P)와 쿠폰 보상(3일 5%/7일 10%)이 서로 다른 버전에 혼재한다. 이번 지급 정책은 위 세 항목이며, 연속 출석 보상은 새로 활성화하지 않았다.

주문·가입·생일·구글 지도 리뷰는 Joy의 기존 프로그램이 담당한다. 앱 후기 적립을 위해 이 기존 규칙을 변경하거나 별도의 공개 submit_form 적립 프로그램을 만들지 않는다. 앱 후기 이벤트를 다른 Joy/Flow 연동에서도 지급하도록 추가하면 이중 지급되지 않도록 한쪽을 제거해야 한다.

## 서버 설정

Joy 관리자 Settings → Manage keys의 **REST API** App key와 Secret key를 백엔드 호스팅 프로젝트의 운영 환경변수에 저장한다.

- `JOY_APP_KEY`: REST App key, 서버 전용.
- `JOY_SECRET_KEY`: REST Secret key, 서버 전용.
- `JOY_SHOP_ID`: 상점 확인용 ID. 다와요 기본값 `hZqmVv0Uq3KmOgFTpV4v`.
- `JOY_SHOP_DOMAIN`: 모바일 잔액 조회의 Shopify 상점 도메인. 다와요 기본값 `41vgwz-cp.myshopify.com`.
- `CUSTOMER_API_SHOP`: 기존 고객 API의 서버 상점 설정을 유지한다. 요청 본문으로 덮어쓸 수 없다.

Vercel 사용 시 process-list 프로젝트 → Settings → Environment Variables에서 Production 범위로 설정한 뒤, 이 코드가 포함된 백엔드를 재배포해야 런타임에 반영된다. 모바일의 `VITE_` 변수에는 비밀키를 넣지 않는다. Headless secret은 필요 없다.

REST v2 공식 엔드포인트는 `https://dev-api.joy.so/rest_api/v2`. 매 지급 전 `/whoami`의 상점 ID와 설치 상태, 고객의 Shopify ID 및 멤버 상태를 확인한다. 다른 상점의 키로는 지급하지 않는다. 모바일 Shopify 토큰 기반 Headless 인증은 REST 키가 아직 없을 때 실제 잔액만 읽는 데 사용한다.

## 배포 전 읽기 전용 확인

실제 서버 환경변수가 주입된 셸에서 `node scripts/check-loyalty.js` 실행. 로컬 파일을 사용할 때는 `node --env-file=.env.local scripts/check-loyalty.js`.

- 키가 없거나 인증/요금제/상점 매칭 실패 시 종료 코드 1.
- 성공 시 ready=true, shopVerified=true, awardTested=false.
- 개인 고객 데이터 조회나 포인트 지급 없이 연결만 검사한다.
- ready=true는 로그인/실지급/DB 통합 검증이 완료됐다는 뜻이 아니다.

## API

- `GET /api/customer/v1/loyalty`: Joy 실제 잔액, 정책, 최근 앱 지급 요청 50건, 구매 재확인 가능한 최근 후기. 잔액 조회 실패 시 verified=false/points=null.
- `POST /api/customer/v1/loyalty` `{claimId}`: 로그인 고객 소유의 기존 지급 요청만 재시도/조회.
- 같은 경로 `{reviewId}`: 고객 소유의 저장된 후기를 다시 구매 확인. 클라이언트의 금액/고객 ID/상점은 받지 않는다.
- `POST /api/customer/v1/attendance`: 서버 날짜로 출석을 저장하고 지급 요청. 동일 날짜 재시도는 같은 요청을 반환.
- `POST /api/customer/v1/photo-reviews`: 실제 후기를 저장하고 Customer Account 주문에서 구매 여부 확인 후 지급 요청.

기존 CustomerRequest 테이블을 사용한다. LOYALTY_CLAIM의 requestKey에 상점/고객/출석 날짜 또는 상품 ID를 포함하고 조건부 updateMany로 한 요청만 SENDING 상태를 획득한다. 이번 포인트 기능만을 위한 신규 테이블/마이그레이션은 없다. 앞선 실데이터 기능의 DB 준비 작업은 별도로 완료돼 있어야 한다.

## 지급 상태와 장애 대응

- READY: 아직 외부 지급 요청 전. 설정 완료 뒤 재시도 가능.
- REJECTED: Joy의 구조화된 4xx 거절 확인. 재시도 가능.
- SENDING: 지급 진행 중. 30초 이후에는 Joy 거래내역으로만 확인.
- UNKNOWN: 통신/응답/서버 오류로 지급 여부 불명. 자동 재지급하지 않는다.
- AWARDED: Joy의 성공 응답 또는 일치 거래 확인 완료.

Joy award API에는 문서화된 idempotencyKey가 없다. 따라서 네트워크 시간 초과/500/응답 유실을 일반 자동 재시도로 처리하면 중복 지급 위험이 있다. 요청 고유값을 Joy 거래 adminNote에 기록하며, UNKNOWN/SENDING은 고객/고유값/적립량이 모두 일치하는 거래를 찾아 완료로 전환한다. 일치 거래를 찾지 못해도 다시 지급하지 않는다. 관리자 확인 전 UNKNOWN을 READY로 강제로 바꾸지 않는다.

거래 확인은 최대 1000건, 구매 확인은 최근 200주문 및 주문별 최대 1000품목으로 제한한다. 한도/페이지 검증 실패는 미확인 상태로 남고 보상 성공을 만들지 않는다. 오래된 이력은 별도 관리자 확인이 필요할 수 있다.

## 출시 확인

1. 위 읽기 전용 연결 검사 및 서버 DB 준비.
2. 백엔드 재배포 후, 새 모바일 빌드에서 실제 테스트 고객 로그인.
3. 기존 Joy 잔액과 앱 잔액 일치 확인.
4. 출석 1회 → Joy 거래/잔액 +50P 확인. 같은 날 재요청 → 추가 적립 0 확인.
5. 구매 상품 일반 후기 → +50P, 다른 구매 상품 사진 후기 → +100P 확인. 같은 상품 반복 → 추가 적립 0 확인.
6. 네트워크 실패 시 미확인 표시 및 재확인 동작 점검.
7. 새 APK/AAB/IPA 배포. cap:sync만으로 설치된 앱은 갱신되지 않는다.

실제 지급 시험은 관리되는 테스트 계정/샌드박스에서 수행하고, 완료 전 출시 승인 상태로 보지 않는다. 이번 작업에서는 운영 고객 잔액을 변경하지 않았다.

## 공식 문서

- https://devdocs.joy.so/joy-rest-api-v2/rest-api-v2/
- https://devdocs.joy.so/joy-rest-api-v2/api-references/activities/
- https://devdocs.joy.so/joy-headless-api/authentication/
- https://shopify.dev/docs/api/customer/2026-01/objects/LineItem
