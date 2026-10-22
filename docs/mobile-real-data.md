# 모바일 실제 데이터 API — 2026-10-21

모바일의 고정 상품·리뷰·캠페인·가격·배송 폴백을 제거하고 실제 DB/Shopify 응답을 사용한다.
`api.mobile.v1.storefront-config`는 오류 시 503을 반환하며 조회로 기본값을 생성하지 않는다. 성공 응답의 `data.source`는 `database`다.

## DB 준비

`CustomerReaction` 모델과 `prisma/migrations/20261021090000_customer_reactions/migration.sql`을 추가했다.
`customerSchema.js`의 추가 DDL, `schemaReadiness.js`, 기존 runtime/Vercel 준비 절차에 포함한다.
새 스키마는 테이블·고유 인덱스·조회 인덱스 추가만 수행한다. 기존 행은 삭제·초기화하지 않는다.
운영 DB에는 이번 작업에서 적용하지 않았다. 이전 migration baseline을 확인하지 않은 migrate reset/deploy는 실행하지 않는다.

## 고객 데이터

공통 `api.customer.v1.$resource.jsx`를 통해 다음 리소스를 제공한다.

| 리소스 | 메서드 | 계약 |
| --- | --- | --- |
| community-posts | GET, POST | GET은 공개 목록, POST는 고객 인증 후 DB 저장. cursor 페이지 조회. |
| community-comments | GET, POST | 공개 원문 확인 후 조회·저장. POST 고객 인증. |
| community-reactions | POST | 상점·대상·고객 고유 upsert, active boolean, 실제 좋아요 건수 반환. |
| customer-requests | GET | 고객 인증 후 본인·현재 상점 이력만 조회. type 및 cursor 필터, returnCount 반환. |
| attendance | GET, POST | 계정별 출석 기록. 날짜는 서버의 Europe/Berlin 기준, 자동 보상 없음. |
| account-delete-request | POST | 고객 인증 후 요청 저장·접수번호 반환. 실제 계정 삭제 실행은 아님. |

기존 photo-reviews는 실제 CustomerReaction 수를 사용하며 productId 필터를 지원한다. 작성·좋아요에는 고객 인증이 필요하다.
구독 접수는 게시된 planId를 DB 설정과 대조하고 제목·가격을 서버에서 결정한다. 요청 본문의 할인 가격은 신뢰하지 않는다.
CustomerRequest의 COMMUNITY_POST, COMMUNITY_COMMENT, ACCOUNT_DELETE는 기존 관리자 요청함에서 상점 범위로 조회·처리한다.
운영 적용은 백엔드/스키마 먼저, 새 모바일 앱 배포 순서다. 이전 모바일 APK는 변경하지 않았다.
