export const ORDER_ADDRESS_OWNER_QUERY = `query OrderAddressOwner($id:ID!) {
  node(id:$id) {
    ... on Order { id name customer { id vat:metafield(namespace:"custom",key:"vat") { value } } }
    ... on DraftOrder { id name customer { id vat:metafield(namespace:"custom",key:"vat") { value } } }
  }
}`;
export const UPDATE_CUSTOMER_VAT_MUTATION = `mutation SetOrderCustomerVat($metafields:[MetafieldsSetInput!]!) {
  metafieldsSet(metafields:$metafields) { metafields { id } userErrors { field message } }
}`;
export const DELETE_CUSTOMER_VAT_MUTATION = `mutation DeleteOrderCustomerVat($metafields:[MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields:$metafields) { deletedMetafields { ownerId namespace key } userErrors { field message } }
}`;
function address(value) {
  if (typeof value!=="string" || value.length>5000) throw new Error("주소 정보를 확인해 주세요.");
  const result=JSON.parse(value);
  if (result===null) return null;
  const allowed=new Set(["name","firstName","lastName","company","address1","address2","zip","city","country","countryCode","countryCodeV2","province","provinceCode","phone"]);
  if (!result || Array.isArray(result) || typeof result!=="object" || Object.entries(result).some(([key,value])=>!allowed.has(key)||typeof value!=="string"||value.length>300)) throw new Error("주소 정보를 확인해 주세요.");
  return result;
}
export async function saveOrderAddress({ admin, db, shop, rawId, formData }) {
  const cleanId = String(rawId || "").replace(/^draft-/, "");
  if (!/^\d+$/.test(cleanId) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop||"")) throw new Error("한 주문의 주소만 수정할 수 있습니다.");
  const isDraft = String(rawId || "").startsWith("draft-");
  const orderId = isDraft ? `gid://shopify/DraftOrder/${cleanId}` : `gid://shopify/Order/${cleanId}`;
  const customShippingAddress=address(String(formData.get("shippingAddress")||"null"));
  const customBillingAddress=address(String(formData.get("billingAddress")||"null"));
  const customVat=String(formData.get("customVat")||"").trim();
  if (customVat.length>64) throw new Error("VAT 번호는 64자 이내로 입력해 주세요.");
  const reply=await admin.graphql(ORDER_ADDRESS_OWNER_QUERY,{variables:{id:orderId}});
  const body=await reply.json();
  if (body.errors?.length || !body.data) throw new Error("주문 고객 정보를 확인할 수 없습니다.");
  const order=body.data.node || body.data.order;
  if (!order || order.id!==orderId) throw new Error("이 상점의 주문을 찾을 수 없습니다.");
  const existing=await db.inspectionRecord.findUnique({where:{orderId},select:{shop:true}});
  if (existing && existing.shop!==shop) throw new Error("이 주문을 수정할 권한이 없습니다.");
  // Customer identity always comes from the authorized order, never a posted customerId.
  if (order.customer?.id && customVat !== (order.customer.vat?.value || "")) {
    const identifiers={ownerId:order.customer.id,namespace:"custom",key:"vat"};
    const field=customVat ? "metafieldsSet" : "metafieldsDelete";
    const response=await admin.graphql(customVat ? UPDATE_CUSTOMER_VAT_MUTATION : DELETE_CUSTOMER_VAT_MUTATION,{variables:{metafields:[
      customVat ? {...identifiers,type:"single_line_text_field",value:customVat} : identifiers,
    ]}});
    const result=await response.json();
    if (result.errors?.length || !result.data?.[field] || result.data[field].userErrors?.length) throw new Error("고객 VAT 저장에 실패했습니다. 다시 시도해 주세요.");
  }
  await db.inspectionRecord.upsert({where:{orderId,shop},update:{customShippingAddress,customBillingAddress,customVat},create:{
    orderId,orderName:order.name,shop,status:"PENDING",customShippingAddress,customBillingAddress,customVat,
  }});
  return {success:true,updatedOrder:{id:orderId,customShippingAddress,customBillingAddress,customVat}};
}

export const INVOICE_ORDER_ACCESS_QUERY = `query InvoiceOrderAccess($ids:[ID!]!) {
  nodes(ids:$ids) {
    ... on Order { id }
    ... on DraftOrder { id }
  }
}`;
export async function verifyInvoiceOrderAccess(admin, rawIds) {
  if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length>100 || rawIds.some(id=>!/^(draft-)?\d+$/.test(id))) throw new Error("유효한 주문 ID가 필요합니다.");
  const cleanIds = [...new Set(rawIds.map(id => id.replace(/^draft-/, "")))];
  const ids = cleanIds.flatMap(id => [`gid://shopify/Order/${id}`, `gid://shopify/DraftOrder/${id}`]);
  const response=await admin.graphql(INVOICE_ORDER_ACCESS_QUERY,{variables:{ids}});
  const payload=await response.json();
  if(payload.errors?.length || !Array.isArray(payload.data?.nodes)) throw new Error("주문 접근 권한을 확인할 수 없습니다.");
  const owned=new Set(payload.data.nodes.filter(Boolean).map(order=>order.id));
  if(cleanIds.some(id=>!owned.has(`gid://shopify/Order/${id}`) && !owned.has(`gid://shopify/DraftOrder/${id}`))) {
    throw new Error("다른 상점의 주문 또는 조회할 수 없는 주문입니다.");
  }
}
