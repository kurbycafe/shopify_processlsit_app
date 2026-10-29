import { randomUUID } from 'node:crypto';
import { requireCustomer } from './customerCommunity.server.js';
import { pushKey, readPushPreferences, permitsPush } from './mobilePushPolicy.server.js';
import { queueCustomerNotification } from './mobileNotificationQueue.server.js';
import { MobileApiError } from './mobileApi.server.js';

export async function customerCartReminder({db,shop,request,verify,input,now=new Date()}) {
 const customerId=await requireCustomer(verify,request,shop);
 const requestKey=pushKey(shop,'CART_REMINDER',customerId);
 const record=await db.customerRequest.findUnique({where:{requestKey}});
 if(input===undefined)return {enabled:Boolean(record && record.status!=='DISABLED')};
 if(input.action==='disable') {await db.customerRequest.updateMany({where:{shop,customerId,requestKey,type:'CART_REMINDER'},data:{status:'DISABLED'}});return {accepted:true,enabled:false};}
 if(input.action==='enable') {
  if(!permitsPush(await readPushPreferences(db,shop,customerId),'MARKETING'))throw new MobileApiError(409,'CONSENT_REQUIRED','Enable push and marketing notifications first.');
  await db.customerRequest.upsert({where:{requestKey},create:{shop,customerId,type:'CART_REMINDER',requestKey,status:'SUSPENDED',payload:{fingerprint:'',cycle:randomUUID()}},update:{status:'SUSPENDED',payload:{fingerprint:'',cycle:randomUUID()}}});
  return {accepted:true,enabled:true};
 }
 if(input.action!=='sync' || !Array.isArray(input.items) || input.items.length>100 || typeof input.suspended!=='boolean')throw new MobileApiError(400,'INVALID_INPUT','Invalid cart reminder request.');
 if(!record || record.status==='DISABLED')return {accepted:false,enabled:false};
 const items=input.items.map(item=>{if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item?.variantId || '') || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>999)throw new MobileApiError(400,'INVALID_INPUT','Invalid cart item.');return [item.variantId,item.quantity];}).sort((a,b)=>a[0].localeCompare(b[0]));
 const fingerprint=items.length && !input.suspended ? pushKey(items) : '';
 if(fingerprint && fingerprint===record.payload?.fingerprint && ['ACTIVE','NOTIFIED'].includes(record.status))return {accepted:true,enabled:true};
 const status=fingerprint?'ACTIVE':'SUSPENDED';
 const payload={fingerprint,cycle:randomUUID(),...(fingerprint?{dueAt:new Date(now.getTime()+24*60*60*1000).toISOString()}: {})};
 const updated=await db.customerRequest.updateMany({where:{shop,customerId,requestKey,type:'CART_REMINDER',status:{in:['ACTIVE','NOTIFIED','SUSPENDED']},updatedAt:record.updatedAt},data:{status,payload}});
 if(updated.count!==1)throw new MobileApiError(409,'STALE_CART','Cart changed. Please retry.');
 return {accepted:true,enabled:true};
}

export async function checkCartReminders({db,shop,now=new Date(),limit=50}) {
 const rows=await db.customerRequest.findMany({where:{shop,type:'CART_REMINDER',status:'ACTIVE',payload:{path:['dueAt'],lte:now.toISOString()}},orderBy:{updatedAt:'asc'},take:limit});
 for(const row of rows){
  const current=await db.customerRequest.findFirst({where:{id:row.id,shop,customerId:row.customerId,type:'CART_REMINDER',status:'ACTIVE',updatedAt:row.updatedAt}});
  if(!current)continue;
  const queued=await queueCustomerNotification({db,shop,customerId:row.customerId,category:'MARKETING',eventKey:`cart:${row.id}:${row.payload.cycle}`,title:'장바구니 상품 안내',body:'남겨둔 장바구니 상품을 확인해 보세요.',target:{type:'cart'},now});
  await db.customerRequest.updateMany({where:{id:row.id,shop,status:'ACTIVE',updatedAt:row.updatedAt},data:{status:queued.queued?'NOTIFIED':'DISABLED'}});
 }
}
