import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MobileApiError } from './mobileApi.server.js';
import { pushKey } from './mobilePushPolicy.server.js';

const identity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{20,100}$/.test(value);
const secretHash = secret => pushKey('DEVICE_SECRET', secret);
function matchesSecret(record, secret) {
  const expected = record?.payload?.secretHash, actual = secretHash(secret);
  return typeof expected === 'string' && expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
export async function guestNoticeDevice({ db, shop, input }) {
  const { installationId, deviceSecret, bindingId, action } = input || {};
  if (![installationId, deviceSecret, bindingId].every(identity) || !['register','unregister'].includes(action)) throw new MobileApiError(400, 'INVALID_DEVICE', 'Invalid notice device.');
  const requestKey = pushKey(shop, 'PUSH_DEVICE', installationId);
  const revocationKey = pushKey(shop, 'PUSH_REVOCATION', installationId, bindingId);
  const write = async tx => {
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const existing = await tx.customerRequest.findUnique({ where: { requestKey } });
    if (existing && !matchesSecret(existing, deviceSecret)) throw new MobileApiError(403, 'DEVICE_MISMATCH', 'Device identity does not match.');
    if (action === 'unregister') {
      await tx.customerRequest.upsert({ where: { requestKey: revocationKey }, create: { shop, type:'PUSH_REVOCATION', requestKey:revocationKey, status:'REVOKED', payload:{ installationId, bindingId, secretHash:secretHash(deviceSecret) } }, update:{} });
      if (existing && !existing.customerId) await tx.customerRequest.updateMany({ where:{ id:existing.id, shop, payload:{ path:['bindingId'], equals:bindingId } }, data:{ status:'DISABLED' } });
      return { accepted:true, registered:false };
    }
    if (existing?.customerId) throw new MobileApiError(409, 'ACCOUNT_DEVICE', 'Disconnect the signed-in account first.');
    if (await tx.customerRequest.findUnique({ where:{ requestKey:revocationKey } })) throw new MobileApiError(409, 'BINDING_REVOKED', 'Notice registration was revoked.');
    if (input.noticeConsent !== true || input.platform !== 'android' || input.category !== 'NOTICE') throw new MobileApiError(400, 'NOTICE_ONLY', 'Guest devices can subscribe to public notices only.');
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (token.length < 8 || token.length > 512 || /\s/.test(token) || /^(ios|android|web)_dawayo_/.test(token)) throw new MobileApiError(400,'INVALID_TOKEN','Invalid provider token.');
    // A provider token must have a single active binding, including account bindings.
    await tx.customerRequest.updateMany({ where:{ shop, type:'PUSH_DEVICE', requestKey:{ not:requestKey }, payload:{ path:['token'], equals:token } }, data:{ status:'DISABLED', customerId:null } });
    const payload = { installationId, bindingId, secretHash:secretHash(deviceSecret), token, platform:'android', guest:true, noticeConsent:true, registeredAt:new Date().toISOString() };
    await tx.customerRequest.upsert({ where:{ requestKey }, create:{ shop, type:'PUSH_DEVICE', requestKey, customerId:null, status:'ACTIVE', payload }, update:{ customerId:null, status:'ACTIVE', payload } });
    return { accepted:true, registered:true };
  };
  return db.$transaction ? db.$transaction(write) : write(db);
}

export async function queueGuestNotices({ db, shop, campaign, devices }) {
  if (campaign.payload.category !== 'NOTICE' || campaign.payload.recipients.length) return;
  for (const device of devices) {
    const requestKey=pushKey(shop,'PUSH_GUEST_DELIVERY',campaign.id,device.id,device.payload.bindingId);
    await db.customerRequest.upsert({ where:{ requestKey }, create:{ shop, type:'PUSH_GUEST_DELIVERY', requestKey, status:'QUEUED',
      payload:{ notificationId:campaign.id, deviceId:device.id, binding:device.payload.bindingId, category:'NOTICE', attempts:0, availableAt:new Date(0).toISOString() } }, update:{} });
  }
}
export async function dispatchGuestNotices({ db, shop, send, limit=20, now=new Date() }) {
  await db.customerRequest.updateMany({ where:{ shop, type:'PUSH_GUEST_DELIVERY', status:'SENDING', updatedAt:{ lt:new Date(now.getTime()-120000) } }, data:{ status:'UNKNOWN' } });
  const jobs=await db.customerRequest.findMany({ where:{ shop, type:'PUSH_GUEST_DELIVERY', status:{ in:['QUEUED','RETRY'] }, payload:{ path:['availableAt'], lte:now.toISOString() } }, orderBy:{ id:'asc' }, take:limit });
  let processed=0;
  const deadline=Date.now()+20000;
  for (const job of jobs) {
    if (Date.now()>=deadline) break;
    const [campaign,device]=await Promise.all([
      db.customerRequest.findFirst({ where:{ id:job.payload.notificationId, shop, type:'PUSH_CAMPAIGN' } }),
      db.customerRequest.findFirst({ where:{ id:job.payload.deviceId, shop, type:'PUSH_DEVICE', customerId:null, status:'ACTIVE' } }),
    ]);
    const where={ id:job.id, shop, status:job.status, updatedAt:job.updatedAt };
    if (!campaign || campaign.payload.category!=='NOTICE' || campaign.payload.recipients.length || campaign.payload.target.type!=='home' || !device?.payload.guest || device.payload.noticeConsent!==true || device.payload.bindingId!==job.payload.binding || Date.parse(campaign.payload.scheduledAt)+7*86400000<=now.getTime()) {
      await db.customerRequest.updateMany({ where, data:{ status:'SKIPPED' } }); continue;
    }
    const leaseId=randomUUID(), attempts=(job.payload.attempts||0)+1;
    if ((await db.customerRequest.updateMany({ where, data:{ status:'SENDING', payload:{...job.payload,leaseId} } })).count!==1) continue;
    const finish=(status,extra={})=>db.customerRequest.updateMany({ where:{ id:job.id, shop, status:'SENDING', payload:{path:['leaseId'],equals:leaseId} }, data:{status,payload:{...job.payload,leaseId,attempts,...extra}} });
    const live=await db.customerRequest.findFirst({ where:{ id:device.id, shop, customerId:null, status:'ACTIVE', payload:{path:['bindingId'],equals:job.payload.binding} } });
    if (!live?.payload.guest || live.payload.noticeConsent!==true) { await finish('SKIPPED'); continue; }
    try {
      const providerId=await send({token:live.payload.token,notificationId:campaign.id,category:'NOTICE',guest:true,title:campaign.payload.title,body:campaign.payload.body});
      await finish('SENT',{providerId,sentAt:now.toISOString()});
    } catch(error) {
      const code=String(error.code||'UNKNOWN').replace(/^messaging\//,'');
      if (['registration-token-not-registered','invalid-registration-token'].includes(code)) {
        await db.customerRequest.updateMany({where:{id:device.id,shop,customerId:null,status:'ACTIVE',payload:{path:['bindingId'],equals:job.payload.binding}},data:{status:'DISABLED'}});
        await finish('FAILED',{errorCode:'TOKEN_EXPIRED'});
      } else if (['server-unavailable','quota-exceeded','message-rate-exceeded','device-message-rate-exceeded','internal-error'].includes(code) && attempts<5) {
        await finish('RETRY',{errorCode:'PROVIDER_RETRY',availableAt:new Date(now.getTime()+60000*2**attempts).toISOString()});
      } else await finish(['invalid-argument','mismatched-credential','authentication-error','NOT_CONFIGURED'].includes(code)?'FAILED':'UNKNOWN',{errorCode:'PROVIDER_REJECTED_OR_UNKNOWN'});
    }
    processed++;
  }
  return processed;
}
