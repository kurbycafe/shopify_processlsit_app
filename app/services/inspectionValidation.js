const ISSUE_TYPES = new Set(["REFUND", "CREDIT", "SUBSTITUTE"]);
const lineKey = (line) => line.variant?.id || (line.sku ? `sku:${line.sku}` : null);

export function restoreSavedInspections(lines, saved = []) {
  const result = new Map();
  const liveCounts = new Map();
  const legacy = new Map();
  for (const line of lines) { const key=lineKey(line); liveCounts.set(key,(liveCounts.get(key)||0)+1); }
  for (const item of saved) {
    if (item.orderLineId) { result.set(item.orderLineId,item); continue; }
    const key=item.variantId && item.variantId!=="N/A" ? item.variantId : item.sku ? `sku:${item.sku}` : null;
    if (!legacy.has(key)) legacy.set(key,[]);
    legacy.get(key).push(item);
  }
  for (const line of lines) {
    const key=lineKey(line), matches=legacy.get(key)||[];
    if (!result.has(line.id) && key && liveCounts.get(key)===1 && matches.length===1) result.set(line.id,matches[0]);
  }
  return result;
}
export function normalizeInspectionItems(input, lines) {
  if (!Array.isArray(input) || input.length===0 || input.length>5000 || input.length!==lines.length) {
    throw new Error("현재 주문의 모든 상품을 불러온 뒤 검수해 주세요.");
  }
  const source = new Map(lines.map(line=>[line.id,line]));
  const seen = new Set();
  return input.map(item=>{
    const line=source.get(item?.id);
    if (!line || seen.has(item.id)) throw new Error("주문 상품이 변경되었거나 중복되었습니다. 주문을 다시 조회해 주세요.");
    seen.add(item.id);
    if (!Number.isSafeInteger(item.inspectedQuantity) || item.inspectedQuantity<0 || item.inspectedQuantity>line.quantity) {
      throw new Error("검수 수량은 0부터 실제 주문 수량까지의 정수여야 합니다.");
    }
    if (Number(item.orderedQuantity)!==line.quantity) throw new Error("주문 수량이 변경되었습니다. 주문을 다시 조회해 주세요.");
    const issueType=item.issueType || null;
    if (issueType && !ISSUE_TYPES.has(issueType)) throw new Error("유효하지 않은 검수 사유입니다.");
    if (issueType==="SUBSTITUTE" && !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.substitutedVariantId||"")) {
      throw new Error("실제 대체 상품을 선택해 주세요.");
    }
    if (typeof item.issueNote!=="string" && item.issueNote!=null) throw new Error("검수 메모를 확인해 주세요.");
    if ((item.issueNote||"").length>2000) throw new Error("검수 메모는 2000자 이내로 입력해 주세요.");
    return { ...item, variantId:line.variant?.id||"N/A", title:line.title, productTitle:line.title, variantTitle:line.variantTitle||line.variant?.title||"",
      sku:line.sku||line.variant?.sku||"", barcode:line.variant?.barcode||"", orderedQuantity:line.quantity,
      issueType, issueNote:item.issueNote||"", substitutedVariantId:issueType==="SUBSTITUTE"?item.substitutedVariantId:null,
      substitutedProductTitle:issueType==="SUBSTITUTE"?item.substitutedProductTitle||"":null,
    };
  });
}

// Existing warehouse integrations can provide a line ID or an unambiguous variant/SKU.
export function normalizeOperationalInspectionItems(input, lines) {
  if (!Array.isArray(input) || !input.length) throw new Error("검수 상품이 필요합니다.");
  const byId=new Map(lines.map(line=>[line.id,line]));
  const mapped=input.map(item=>{
    if (!item || typeof item!=="object") throw new Error("검수 상품 형식을 확인해 주세요.");
    const explicit=item.orderLineId || (byId.has(item.id)?item.id:null);
    const matches=explicit ? (byId.has(explicit)?[byId.get(explicit)]:[]) : lines.filter(line=>
      item.variantId && item.variantId!=="N/A" ? line.variant?.id===item.variantId : item.sku && line.sku===item.sku);
    if (matches.length!==1) throw new Error("동일 상품이 여러 주문 행에 있으면 원본 orderLineId를 보내주세요.");
    return {...item,id:matches[0].id,orderedQuantity:item.orderedQuantity??matches[0].quantity};
  });
  return normalizeInspectionItems(mapped,lines);
}
