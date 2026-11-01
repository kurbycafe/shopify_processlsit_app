/**
 * Dawayo Odoo ERP SKU Category Convention & Auto-Classification Utilities
 * Format: [CategoryPrefix: 3 chars (e.g., C40, B20)][Sequence: 3 digits (e.g., 305)] -> e.g., C40305
 */

export const ODOO_SKU_CATEGORIES = [
  { prefix: "A10", label: "A10 · 쌀 / 잡곡 / 콩 / 팥", defaultStart: 1 },
  { prefix: "A20", label: "A20 · 건조 야채 / 나물", defaultStart: 1 },
  { prefix: "A30", label: "A30 · 김 / 미역 / 다시마 / 해조류", defaultStart: 1 },
  { prefix: "A40", label: "A40 · 자반 / 조미김 / 국물가루", defaultStart: 1 },
  { prefix: "B10", label: "B10 · 장류 (고추장 / 된장 / 쌈장 / 간장)", defaultStart: 1 },
  { prefix: "B20", label: "B20 · 소스 / 양념 / 고춧가루 / 기름 / 액젓", defaultStart: 1 },
  { prefix: "B30", label: "B30 · 분말 / 가루류 (부침 / 튀김 / 찹쌀 / 카레)", defaultStart: 1 },
  { prefix: "C10", label: "C10 · 건면 / 국수 / 당면 / 냉면 / 우동", defaultStart: 1 },
  { prefix: "C20", label: "C20 · 봉지라면 / 멀티라면", defaultStart: 1 },
  { prefix: "C30", label: "C30 · 컵라면 / 용기면 / 컵떡볶이", defaultStart: 1 },
  { prefix: "C40", label: "C40 · 즉석국·탕·찌개 / 햇반 / 컵밥 / 카레·스프", defaultStart: 1 },
  { prefix: "C50", label: "C50 · 통조림 / 병조림 (참치 / 스팸 / 팥)", defaultStart: 1 },
  { prefix: "C60", label: "C60 · 단무지 / 절임류", defaultStart: 1 },
  { prefix: "D10", label: "D10 · 음료 / 주스 / 두유 / 우유 / 에이드", defaultStart: 1 },
  { prefix: "D20", label: "D20 · 차 / 커피 / 분말차", defaultStart: 1 },
  { prefix: "D30", label: "D30 · 주류 (소주 / 맥주 / 막걸리 / 사케)", defaultStart: 1 },
  { prefix: "F10", label: "F10 · 과자 / 스낵 / 초콜릿 / 파이 / 젤리", defaultStart: 1 },
  { prefix: "F20", label: "F20 · 상온 빵 / 호떡 / 상온 떡", defaultStart: 1 },
  { prefix: "K10", label: "K10 · 냉장 김치류 (포기 / 총각 / 맛김치)", defaultStart: 1 },
  { prefix: "K20", label: "K20 · 냉장 두부 / 나물 / 신선식품", defaultStart: 1 },
  { prefix: "T10", label: "T10 · 냉동 간식 / 호빵 / 핫도그 / 튀김 / 순대", defaultStart: 1 },
  { prefix: "T20", label: "T20 · 냉동 만두류", defaultStart: 1 },
  { prefix: "T30", label: "T30 · 냉동 어묵 / 부산어묵", defaultStart: 1 },
  { prefix: "T40", label: "T40 · 냉동 떡류 (송편 / 떡국떡 / 떡볶이떡)", defaultStart: 1 },
  { prefix: "T60", label: "T60 · 냉동 면류 / 냉면사리", defaultStart: 1 },
  { prefix: "T70", label: "T70 · 냉동 육류 / 수산가공 / 닭강정", defaultStart: 1 },
  { prefix: "X10", label: "X10 · 즉석 반찬류 (무말랭이 / 볶음)", defaultStart: 1 },
  { prefix: "Y10", label: "Y10 · 주방 / 식기 / 생활용품", defaultStart: 1 },
  { prefix: "Z10", label: "Z10 · 대용량 / 업소용 식자재", defaultStart: 1 },
];

export const ODOO_SKU_CATEGORY_OPTIONS = ODOO_SKU_CATEGORIES.map((c) => ({
  label: c.label,
  value: c.prefix,
}));

const CLASSIFICATION_RULES = [
  // Z10: 대용량 업소용 (10L, 14kg, 15L, 18L, 20kg 등)
  { prefix: "Z10", pattern: /(\b1[4-9]\s*(kg|l)\b|\b20\s*(kg|l)\b|업소용|대용량\s*1[0-9])/i },
  // Y10: 주방/생활용품
  { prefix: "Y10", pattern: /(그릇|접시|냄비|김발|젓가락|수저|부탄가스|불판|집게|가위|고무장갑|수세미)/i },
  // K10: 김치류 (단, 김치라면/김치사발면/김치만두 제외)
  {
    prefix: "K10",
    pattern: /(포기김치|총각김치|맛김치|김장김치|열무김치|갓김치|백김치|깍두기|석박지|겉절이|\bchong\s*gak\b|\bkimchi\b)/i,
    exclude: /(라면|사발면|큰사발|만두|찌개양념|볶음면|스낵|과자|컵)/i,
  },
  // K20: 두부 (마파두부 소스, 순두부찌개 양념 제외)
  {
    prefix: "K20",
    pattern: /(두부\s*찌개용|두부\s*부침용|신선한\s*두부|연두부|유부초밥|\btofu\b)/i,
    exclude: /(소스|양념|즉석|호밍스|미소스프|된장국)/i,
  },
  // T20: 냉동 만두
  { prefix: "T20", pattern: /(만두|교자|딤섬|\bmandu\b|\bgyoza\b)/i },
  // T30: 냉동 어묵
  { prefix: "T30", pattern: /(어묵|오뎅|\bfish\s*cake\b)/i, exclude: /(컵|라면|우동|분말|스프)/i },
  // T40: 냉동 떡류
  { prefix: "T40", pattern: /(송편|백송편|쑥송편|떡국떡|인절미|찹쌀떡|다이후쿠|군고구마떡|찰떡볶이|\brice\s*cake\b|\bbaeksongpyeon\b)/i },
  // T60: 냉동 면류
  { prefix: "T60", pattern: /(평양냉면\s*사리|냉면사리|콩칼국수|생칼국수)/i },
  // T70: 냉동 육류/수산
  { prefix: "T70", pattern: /(닭강정|빙어알|마사고|날치알|오징어채|낙지|쭈꾸미)/i },
  // T10: 냉동 간식/호빵/핫도그/순대/튀김
  { prefix: "T10", pattern: /(호빵|핫도그|새우튀김|스프링롤|찰순대|순대|냉동\s*고구마|동치미냉면육수|냉동)/i },
  // B10: 장류 (고추장, 된장, 쌈장, 간장, 춘장, 청국장)
  {
    prefix: "B10",
    pattern: /(고추장|된장|쌈장|진간장|양조간장|국간장|맛간장|초고추장|비빔장|춘장|\bgochujang\b|\bdoenjang\b|\bssamjang\b|\bsoy\s*sauce\b)/i,
    exclude: /(찌개|된장국|라면|멸치볶음|진미채|불고기|치킨소스|가루|분말)/i,
  },
  // B20: 고춧가루/고추가루 및 소스/양념/기름/액젓/조미료
  {
    prefix: "B20",
    pattern: /(고춧가루|고추가루|건고추|참기름|들기름|고추기름|식초|홍초|미림|맛술|액젓|피쉬소스|멸치액젓|까나리액젓|참치액|다시다|미원|후리카케|와사비|마요네즈|돈까스\s*소스|돈카츠\s*소스|불닭소스|우동소스|찌개양념|불고기\s*양념|갈비\s*양념|떡볶이\s*양념|칠리\s*소스|타코야키\s*소스|츠유|물엿|올리고당|굴소스|고추\s*마늘|겨자가루|들깨가루|육수.*링)/i,
  },
  // B30: 분말/가루류 (부침가루, 튀김가루, 찹쌀가루, 쌀가루, 빵가루, 카레가루, 짜장가루, 콩가루, 미숫가루, 참깨)
  {
    prefix: "B30",
    pattern: /(부침가루|튀김가루|찹쌀가루|쌀가루|빵가루|카레가루|짜장\s*가루|콩가루|도토리묵\s*가루|청포묵가루|빈대떡가루|타피오카\s*가루|쑥가루|엿기름\s*가루|오코노미야끼.*가루|호떡믹스|볶음참깨|통참깨|검은깨)/i,
  },
  // C30: 컵라면/용기면/컵떡볶이
  {
    prefix: "C30",
    pattern: /(사발면|큰사발|작은컵|큰컵|왕뚜껑|용기면|떡볶이\s*용기|짜장\s*용기|컵라면|범벅|\bcup\s*noodle\b|라면볶이\s*컵|볶음면.*컵|쌀국수.*컵|사리곰탕\s*컵)/i,
  },
  // C20: 봉지라면/멀티라면
  {
    prefix: "C20",
    pattern: /(멀티|라면사리|진라면|신라면|안성탕면|삼양\s*라면|참깨라면|짜파게티|짜왕|비빔면|배홍동|진밀면|진짜\s*쫄면|까르보볶음면|치즈볶음면|불닭볶음면|사리곰탕\s*멀티|콩국수\s*라면|쌀국수\s*치킨맛|\binstant\s*noodles\b)/i,
  },
  // C10: 건면/국수/소면/당면/우동/소바/메밀
  {
    prefix: "C10",
    pattern: /(소면|중면|칼국수|메밀국수|메밀\s*국수|막국수|소바|우동\s*사리|유데\s*우동|당면|비빔냉면|쫄면사리|\bsoba\b|\budon\b)/i,
  },
  // C40: 즉석국/탕/찌개/햇반/컵밥/즉석카레/스프/분모자
  {
    prefix: "C40",
    pattern: /(곰탕|설렁탕|도가니탕|육개장|우거지국|배추\s*된장국|미역국|순두부찌개|김치찌개|된장찌개|부대찌개|삼계탕|갈비탕|추어탕|햇반|컵밥|덮밥|비빔밥|골든\s*카레|하야시|마파두부|즉석\s*된장국|미소스프|크림스프|컵\s*스프|분모자)/i,
  },
  // C50: 통조림
  { prefix: "C50", pattern: /(참치캔|고추참치|야채참치|스팸|리챔|런천미트|오구라\s*안|옥수수캔|번데기|황도|백도)/i },
  // C60: 절임/단무지
  { prefix: "C60", pattern: /(단무지|우엉|오이\s*절임|후쿠진즈케|락교|생강절임|할라피뇨)/i },
  // A30: 김/미역/다시마/해조류
  { prefix: "A30", pattern: /(김밥김|도시락김|재래김|돌김|구운김|김가루|미역|다시마|파래|매생이|톳)/i, exclude: /(자반)/i },
  // A40: 자반/조미김
  { prefix: "A40", pattern: /(자반|맛돌김|콩국물\s*가루)/i },
  // A10: 쌀/잡곡/콩/팥
  { prefix: "A10", pattern: /(햅쌀|담양쌀|김포쌀|신유빈\s*쌀|\b쌀\s*\d|붉은\s*팥|서리태|검은\s*콩|병아리콩|현미|찹쌀\s*\d|흑미|보리쌀|기장|수수|율무)/i },
  // A20: 건나물/건야채
  { prefix: "A20", pattern: /(다진\s*청양고추|고사리|도라지|시래기|무말랭이\s*건|건표고|목이버섯)/i },
  // D30: 주류 (소주, 맥주, 막걸리, 사케)
  { prefix: "D30", pattern: /(소주|이즈백|참이슬|처음처럼|새로|화요|맥주|카스|테라|클라우드|막걸리|사케|청하|백세주|복분자)/i, exclude: /(하이볼)/i },
  // D20: 커피/차
  { prefix: "D20", pattern: /(커피믹스|모카골드|카누|보리차|옥수수수염차|헛개차|녹차|둥굴레차|유자차|생강차|대추차|율무차|미숫가루.*스틱|15곡\s*미숫가루)/i },
  // D10: 음료/주스/두유/우유
  { prefix: "D10", pattern: /(밀키스|웰치스|갈아만든|식혜|수정과|베지밀|두유|에이드|아이스톡|보바|버블\s*젤리|우유|라떼|하이볼|비타500|박카스|알로에|코코팜|봉봉|데미소다|칠성사이다|환타|콜라|\bml\b)/i },
  // F20: 상온 빵/호떡/떡볶이떡
  { prefix: "F20", pattern: /(꿀호떡|찹쌀호떡|단팥빵|크림빵|보름달|떡볶이떡)/i },
  // F10: 과자/스낵/초콜릿/파이/젤리
  { prefix: "F10", pattern: /(스낵|과자|새우깡|바나나킥|초코파이|빼빼로|포키|킷캣|오사쯔|에이스|전병|설병|선과|크라운산도|초코픽|포테토칩|츄러스|라면스낵|칩칩|맛동산|홈런볼|고래밥|꼬깔콘|젤리|사탕|캔디|껌)/i },
  // X10: 반찬류
  { prefix: "X10", pattern: /(무말랭이\s*무침|멸치볶음|진미채\s*볶음|고추무침|반찬|장조림|콩자반|깻잎)/i },
];

/**
 * Infers the Odoo 3-character SKU category prefix (e.g., "C40", "B20") from a product name.
 */
export function inferOdooSkuPrefix(productName = "") {
  const clean = String(productName || "").trim();
  if (!clean) return "C40";

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.exclude && rule.exclude.test(clean)) continue;
    if (rule.pattern.test(clean)) {
      return rule.prefix;
    }
  }

  return "C40";
}

/**
 * Parses the 3-digit sequence number from an SKU matching the given 3-char prefix.
 * Ignores 4+ digit anomalous typos (e.g., B100001) when finding the standard 3-digit sequence.
 */
export function parseStandardSkuSequence(sku, prefix) {
  const cleanSku = String(sku || "").trim().toUpperCase();
  const cleanPrefix = String(prefix || "").trim().toUpperCase();
  if (!cleanSku || !cleanPrefix || !cleanSku.startsWith(cleanPrefix)) return null;

  const rest = cleanSku.slice(cleanPrefix.length);
  const match = rest.match(/^(\d{3})(?:[-_][A-Z0-9]+)?$/i);
  if (!match) return null;

  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num >= 1 ? num : null;
}

/**
 * Computes the next available SKU for a prefix given a Set of all existing upper-case SKUs.
 */
export function computeNextAvailableSku(prefix, existingSkusIterable = []) {
  const cleanPrefix = String(prefix || "C40").trim().toUpperCase();
  const usedSet = new Set();
  let maxSeq = 0;

  for (const raw of existingSkusIterable) {
    if (!raw) continue;
    const upper = String(raw).trim().toUpperCase();
    if (!upper) continue;
    usedSet.add(upper);
    // Also mark base SKU before suffix (e.g., B10137-1 -> mark B10137 as used too)
    const baseMatch = upper.match(/^([A-Z]\d{2}\d{3})[-_]/);
    if (baseMatch) usedSet.add(baseMatch[1]);

    const seq = parseStandardSkuSequence(upper, cleanPrefix);
    if (seq !== null && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  let nextNum = maxSeq + 1;
  while (nextNum < 9999) {
    const candidate = `${cleanPrefix}${String(nextNum).padStart(3, "0")}`;
    if (!usedSet.has(candidate)) {
      return candidate;
    }
    nextNum++;
  }

  return `${cleanPrefix}${Date.now().toString().slice(-4)}`;
}

/**
 * Validates that an SKU follows safe Odoo/Shopify format rules.
 */
export function validateOdooSkuFormat(sku) {
  const clean = String(sku || "").trim().toUpperCase();
  if (!clean) {
    return { valid: false, normalized: "", error: "SKU를 입력해 주세요." };
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(clean)) {
    return {
      valid: false,
      normalized: clean,
      error: "SKU는 영문 대문자, 숫자, 하이픈(-)만 사용할 수 있습니다 (2~32자).",
    };
  }
  return { valid: true, normalized: clean, error: null };
}

