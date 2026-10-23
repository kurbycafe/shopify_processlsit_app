# 상품 온도 관리 분리 — 2026-10-23

구현·검증 완료. 운영 배포는 수행하지 않았다.

## 사용하는 방법

앱 관리 → 상품 온도 관리 → 상품명/ID 검색 및 온도 필터 → 체크박스 선택 → 변경할 온도 선택 → 선택 상품 일괄 변경.

- 실제 Shopify 상품의 대표 사진·이름·상품별 총재고를 조회한다. 재고 추적 안 함과 0개를 구분한다.
- 온도는 미설정·상온·냉장·냉동으로 구분한다. 미설정을 상온으로 추정하지 않는다.
- 상품 조회는 100개씩 다음 커서를 끝까지 따라간다. 조회 중에는 불러온 개수를 표시하고 전체 조회가 끝난 뒤 일괄 저장을 허용한다.
- 화면은 페이지당 50개다. 전체 선택은 현재 페이지이며 필터·검색·페이지 변경 시 선택을 초기화한다.
- 저장은 실제 현재 상점에 있는 상품을 서버에서 다시 확인한 후 처리한다. 실패하면 선택 상태가 유지되고 성공으로 안내하지 않는다.
- 온도 설정은 MHD·가격·재고와 분리한다. MHD/특가 편집의 온도 입력을 제거하고, 기존 상품 ID·SKU 연결 및 MHD 속성 호환을 유지한다.
- 관리자 동시 수정에 대비해 버전 조건 저장·재시도와 최신 온도 맵 보존을 적용했다.
- 모바일은 기존 productOverrides 응답 형식으로 새 온도를 받는다. 이 기능을 위해 새로운 DB 테이블이나 모바일 API 형식 변경은 필요하지 않다.

## 변경 파일

- app/components/ProductTemperatureManager.jsx: 목록·검색·온도 필터·체크박스·일괄 변경.
- app/routes/app.product-temperatures.jsx: 관리자 인증을 거치는 상품 조회·저장 API.
- app/services/productTemperatures.server.js: Shopify 조회·대상 검증·일괄 저장·충돌 처리.
- app/utils/productTemperatures.js: 온도 판정·기존 모바일 응답 병합.
- app/routes/app.app-management.jsx: 독립 탭과 MHD 분리.
- app/services/mobileStorefront.server.js: 독립 설정 보존과 모바일 호환 응답.
- tests/product-temperatures.test.js: 재고·미설정·권한·충돌·MHD·SKU·배송 정책 보존 검사 18개.
- scripts/check-product-temperature-ui.mjs: 격리된 브라우저의 목록·필터·저장 성공/실패 검사.

## 검증

- 서버 전체 테스트 269개 통과.
- 변경 파일 ESLint 통과.
- 공식 Shopify Admin API 2026-10 스키마로 두 GraphQL 쿼리 검증 통과.
- 실제 컴포넌트를 Chrome에서 실행해 테스트 상품 105개의 다음 페이지 조회, 미설정 필터, 검색과 필터 교집합, 단일 선택 저장, 저장 후 필터 이탈, 현재 페이지 50개 선택, 페이지 변경 시 초기화, 실패 시 선택/기존 온도 보존 확인. 렌더링 오류 없음.
- 최종 npm run build 성공. 기존 청크 분할 관련 빌드 경고는 남아 있으나 빌드는 성공했다.

브라우저 검사는 격리된 테스트 응답으로 수행했으며 운영 Shopify/DB 데이터를 변경하지 않았다. 실제 Shopify 관리자 로그인 환경의 조회·저장 최종 확인과 운영 배포는 아직 수행하지 않았다.

## 공식 참고

- [Shopify 상품 조회](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/product)
- [App Bridge의 인증된 백엔드 fetch](https://shopify.dev/docs/api/app-home/v1.0/apis/authentication-and-data/resource-fetching-api)

화면 예시는 테스트 데이터다: [미설정 상품 필터 화면](C:/Users/po043/.codex/visualizations/2026/10/14/01a13c31-4a2f-7f81-b0f2-4edd9a095395/product-temperature-manager.png).
