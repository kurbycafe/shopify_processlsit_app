# MHD · 상품 속성 관리 — 2026-10-23

상품 온도 관리와 같은 실상품 목록을 앱 관리의 MHD · 상품 속성 탭에 추가했다.

- Shopify 상품의 사진, 이름, 첫 옵션 SKU, 총재고, custom.producttype 온도와 현재 앱 속성을 조회한다.
- 상품명·SKU·상품 ID 검색, 속성 미설정·MHD·기한 경과·추천·오픈예정·연령·보증금 필터.
- 페이지당 50개, 페이지 이동 시 선택 유지, 전체 검색 결과 선택.
- 선택한 전체 상품을 최대 100개씩 자동 처리하므로 사용자 선택 총수에 대한 제한은 없다.
- 각 항목의 변경 체크박스를 켠 필드만 저장한다. 다른 날짜, 언어별 문구, 정책, 온도 메타필드, 가격, 재고는 덮어쓰지 않는다.
- MHD 해제는 해당 날짜와 참고 할인가를 함께 비운다. 날짜를 입력하면 MHD를 활성화한다.
- MHD 참고 할인가 필드는 기존 CMS 설정을 관리한다. 실제 Shopify 판매가 및 결제 금액은 변경하지 않으며 화면에서 명시했다.
- 기존 수동 설정 및 미연결 기록은 별도 버튼 아래 보존했다. 신규 목록은 실제 Shopify 상품 ID로만 연결된다.
- 서버는 인증된 상점의 실제 상품인지 확인하고, 필드·날짜·금액을 검증한 후 저장한다.
- DB 버전 조건으로 충돌 시 최신 설정에 선택 필드만 다시 적용한다.
- 저장 실패 시 완료 상품은 제외하고 남은 상품을 선택 상태로 유지한다.
- 모바일은 명시적인 MHD·추천·오픈예정 해제 및 안내 배지 삭제를 이전 상품 값보다 우선한다.

검증:
- 백엔드 전체 테스트 278개 통과.
- 모바일 기존 검사 46개 및 Node 테스트 86개 통과.
- 양쪽 빌드 및 변경 파일 린트 통과.
- 새로운 GraphQL 조회 2개를 Shopify Admin API 2026-10 공식 스키마로 검증했다.
- 실제 컴포넌트와 서버 저장 함수를 Chrome에서 실행했다. 격리된 305개 상품/DB fixture로 전체 커서 조회, SKU 검색, 미설정 필터, 개별 수정 시 미선택 필드 보존, 페이지별 선택/해제, 전체 선택, 4개 요청 자동 저장, 100개 성공 후 실패 시 205개만 재시도하는 흐름을 확인했다.
- 화면 및 편집 패널 캡처로 표시 상태를 검토했다. 테스트 상품 이미지와 데이터는 브라우저 검사에만 사용한다.

운영 배포 및 Play Store 앱 업데이트는 수행하지 않았고 운영 Shopify/DB 데이터는 변경하지 않았다.

주요 파일:
- app/components/ProductAttributesManager.jsx
- app/services/productAttributes.server.js
- app/utils/productAttributes.js
- app/routes/app.product-attributes.jsx
- app/routes/app.app-management.jsx
- tests/product-attributes.test.js
- scripts/check-product-attribute-ui.mjs

공식 참고:
https://shopify.dev/docs/api/admin-graphql/2026-10/queries/products
https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Product
