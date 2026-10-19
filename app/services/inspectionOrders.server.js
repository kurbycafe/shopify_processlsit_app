import { completeOrderLineItems } from "./orderPagination.server.js";
const FIELDS = `id name email cancelledAt lineItems(first:100) {
  pageInfo { hasNextPage endCursor }
  edges { node { id title variantTitle sku quantity variant { id title sku barcode image { url }
    product { featuredImage { url } expiryDate:metafield(namespace:"freshly",key:"expiry_date") { value } }
  } } }
}`;
export const FIND_INSPECTION_ORDER_QUERY = `query FindInspectionOrder($query:String!) { orders(first:1,query:$query) { nodes { ${FIELDS} } } }`;
export const INSPECTION_ORDER_QUERY = `query InspectionOrder($id:ID!) { order(id:$id) { ${FIELDS} } }`;
export const INSPECTION_SUBSTITUTES_QUERY = `query InspectionSubstitutes($ids:[ID!]!) { nodes(ids:$ids) { ... on ProductVariant { id title product { title } } } }`;
export async function readInspectionOrder(admin, { id, query }) {
  if (id && !/^gid:\/\/shopify\/Order\/\d+$/.test(id)) throw new Error("올바른 주문 ID가 필요합니다.");
  const response=await admin.graphql(id?INSPECTION_ORDER_QUERY:FIND_INSPECTION_ORDER_QUERY,{variables:id?{id}:{query}});
  const body=await response.json();
  if (body.errors?.length || !body.data) throw new Error("주문 조회에 실패했습니다. 다시 시도해 주세요.");
  const order=id?body.data.order:body.data.orders?.nodes?.[0];
  if (!order) return null;
  await completeOrderLineItems(admin,order);
  return order;
}

export async function validateInspectionSubstitutes(admin, items) {
  const ids=[...new Set(items.filter(item=>item.issueType==="SUBSTITUTE").map(item=>item.substitutedVariantId))];
  for(let offset=0;offset<ids.length;offset+=100){
    const batch=ids.slice(offset,offset+100);
    const response=await admin.graphql(INSPECTION_SUBSTITUTES_QUERY,{variables:{ids:batch}});
    const payload=await response.json();
    if(payload.errors?.length || !Array.isArray(payload.data?.nodes))throw new Error("대체 상품을 확인할 수 없습니다.");
    const variants=new Map(payload.data.nodes.filter(Boolean).map(variant=>[variant.id,variant]));
    for(const item of items.filter(item=>batch.includes(item.substitutedVariantId))){
      const variant=variants.get(item.substitutedVariantId);
      if(!variant?.product?.title)throw new Error("삭제되었거나 사용할 수 없는 대체 상품입니다.");
      item.substitutedProductTitle=`${variant.product.title}${variant.title==="Default Title"?"":` (${variant.title})`}`;
    }
  }
  return items;
}
