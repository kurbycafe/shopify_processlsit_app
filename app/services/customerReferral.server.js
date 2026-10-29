import { createHash, randomBytes } from 'node:crypto';
import { requireCustomer } from './customerCommunity.server.js';
import { MobileApiError } from './mobileApi.server.js';

const key=(shop,type,customerId)=>createHash('sha256').update(JSON.stringify([shop,type,customerId])).digest('hex');
export async function customerReferral({db,shop,request,verify,input}) {
  const customerId=await requireCustomer(verify,request,shop);
  if (!db.customerRequest?.upsert || !db.customerRequest?.findFirst) throw new MobileApiError(503,'NOT_CONFIGURED','Referral service unavailable.');
  if (input === undefined) {
    const record=await db.customerRequest.findFirst({where:{shop,customerId,type:'REFERRAL_CODE'},select:{payload:true}});
    const joined=await db.customerRequest.findFirst({where:{shop,customerId,type:'REFERRAL_JOIN'},select:{id:true}});
    return {code:record?.payload?.code || null,hasReferrer:Boolean(joined),rewardsAvailable:false};
  }
  if (input.create === true) {
    const record=await db.customerRequest.upsert({where:{requestKey:key(shop,'REFERRAL_CODE',customerId)},create:{shop,customerId,type:'REFERRAL_CODE',requestKey:key(shop,'REFERRAL_CODE',customerId),payload:{code:randomBytes(10).toString('hex').toUpperCase()}},update:{},select:{payload:true}});
    return {code:record.payload.code,rewardsAvailable:false};
  }
  const code=typeof input.code==='string' ? input.code.trim().toUpperCase() : '';
  if (!/^[A-F0-9]{20}$/.test(code)) throw new MobileApiError(400,'INVALID_CODE','Invalid referral code.');
  const inviter=await db.customerRequest.findFirst({where:{shop,type:'REFERRAL_CODE',payload:{path:['code'],equals:code}},select:{customerId:true}});
  if (!inviter?.customerId || inviter.customerId===customerId) throw new MobileApiError(400,'INVALID_CODE','Invalid referral code.');
  const joinKey=key(shop,'REFERRAL_JOIN',customerId);
  const joined=await db.customerRequest.upsert({where:{requestKey:joinKey},create:{shop,customerId,type:'REFERRAL_JOIN',requestKey:joinKey,payload:{code}},update:{},select:{id:true,payload:true}});
  if (joined.payload?.code!==code) throw new MobileApiError(409,'ALREADY_LINKED','A referrer is already linked.');
  return {accepted:true,hasReferrer:true,rewardsAvailable:false};
}
