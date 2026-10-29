import { pushKey, readPushPreferences, permitsPush } from './mobilePushPolicy.server.js';
import { requireCustomer } from './customerCommunity.server.js';
import { queueCustomerNotification } from './mobileNotificationQueue.server.js';
import { MobileApiError } from './mobileApi.server.js';

export const PRICE_ALERT_VARIANT_QUERY = `query MobilePriceAlert($id: ID!) { productVariant(id: $id) { id price product { id title status onlineStoreUrl } } }`;
const cents = value => typeof value === 'string' && /^\d{1,9}(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
async function getVariant(graphql, shop, variantId) {
  const result = await graphql(shop, PRICE_ALERT_VARIANT_QUERY, {id:variantId});
  if (result?.errors?.length || !result?.data) throw new MobileApiError(502,'SHOPIFY_UNAVAILABLE','Could not check price.');
  const variant = result.data.productVariant;
  if (!variant || variant.id !== variantId || variant.product?.status !== 'ACTIVE' || !variant.product?.onlineStoreUrl || cents(variant.price) === null) throw new MobileApiError(404,'PRODUCT_NOT_FOUND','Product is unavailable.');
  return variant;
}
export async function customerPriceAlerts({db,shop,request,verify,graphql,input}) {
  const customerId=await requireCustomer(verify,request,shop);
  if (input === undefined) {
    const variantId=new URL(request.url).searchParams.get('variantId');
    if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId || '')) throw new MobileApiError(400,'INVALID_INPUT','Invalid variant ID.');
    const records=await db.customerRequest.findMany({where:{shop,customerId,type:'PRICE_ALERT',status:{in:['ACTIVE','NOTIFIED']},requestKey:pushKey(shop,'PRICE_ALERT',customerId,variantId)},take:1,select:{status:true,payload:true}});
    return {alerts:records.map(row=>({variantId:row.payload.variantId,productId:row.payload.productId,status:row.status}))};
  }
  if (!['subscribe','unsubscribe'].includes(input.action) || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(input.variantId || '')) throw new MobileApiError(400,'INVALID_INPUT','Invalid price alert request.');
  const requestKey=pushKey(shop,'PRICE_ALERT',customerId,input.variantId);
  if (input.action==='unsubscribe') {
    await db.customerRequest.updateMany({where:{shop,customerId,requestKey,type:'PRICE_ALERT'},data:{status:'DISABLED'}});
    return {accepted:true,subscribed:false};
  }
  const preferences=await readPushPreferences(db,shop,customerId);
  if (!permitsPush(preferences,'MARKETING')) throw new MobileApiError(409,'CONSENT_REQUIRED','Enable push and marketing notifications first.');
  const existing=await db.customerRequest.findUnique({where:{requestKey}});
  if (existing?.status !== 'ACTIVE' && await db.customerRequest.count({where:{shop,customerId,type:'PRICE_ALERT',status:'ACTIVE'}}) >= 100) throw new MobileApiError(409,'ALERT_LIMIT','Too many price alerts.');
  const variant=await getVariant(graphql,shop,input.variantId);
  const payload={variantId:variant.id,productId:variant.product.id,baselineCents:cents(variant.price),cycle:crypto.randomUUID()};
  await db.customerRequest.upsert({where:{requestKey},create:{shop,customerId,type:'PRICE_ALERT',requestKey,status:'ACTIVE',payload},update:{status:'ACTIVE',payload}});
  return {accepted:true,subscribed:true};
}
export async function checkPriceAlerts({db,shop,graphql,now=new Date(),limit=20}) {
  const rows=await db.customerRequest.findMany({where:{shop,type:'PRICE_ALERT',status:'ACTIVE'},orderBy:{updatedAt:'asc'},take:limit});
  async function checkRow(row) {
    try {
      const variant=await getVariant(graphql,shop,row.payload.variantId);
      const current=cents(variant.price);
      const fresh=await db.customerRequest.findFirst({where:{id:row.id,shop,customerId:row.customerId,type:'PRICE_ALERT',status:'ACTIVE',updatedAt:row.updatedAt}});
      if (!fresh) return;
      if (current < row.payload.baselineCents) {
        const result=await queueCustomerNotification({db,shop,customerId:row.customerId,category:'MARKETING',eventKey:`price:${row.id}:${row.payload.cycle}`,title:'신청 상품 가격 인하',body:`${String(variant.product.title || '신청 상품').slice(0,90)}의 가격이 내려갔습니다.`,target:{type:'product',id:variant.product.id},now});
        if (result.queued) await db.customerRequest.updateMany({where:{id:row.id,shop,status:'ACTIVE',updatedAt:row.updatedAt},data:{status:'NOTIFIED'}});
        else await db.customerRequest.updateMany({where:{id:row.id,shop,status:'ACTIVE',updatedAt:row.updatedAt},data:{status:'DISABLED'}});
      } else await db.customerRequest.updateMany({where:{id:row.id,shop,status:'ACTIVE',updatedAt:row.updatedAt},data:{payload:row.payload}});
    } catch (error) {
      // Move failed checks to the back of the queue; unavailable products are disabled.
      await db.customerRequest.updateMany({where:{id:row.id,shop,status:'ACTIVE',updatedAt:row.updatedAt},data:error?.status===404 ? {status:'DISABLED'} : {payload:row.payload}});
    }
  }
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(5,rows.length)},async()=>{while(cursor<rows.length)await checkRow(rows[cursor++]);}));
}
