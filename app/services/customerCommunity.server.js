import { rewardClaim } from "./customerLoyalty.server.js";
import { LOYALTY_POLICY } from "./joyLoyalty.server.js";
import {createHash} from "node:crypto";
import {MobileApiError} from "./mobileApi.server.js";
const fail=(status,message)=>{throw new MobileApiError(status,"INVALID_INPUT",message);};
const key=values=>createHash("sha256").update(JSON.stringify(values)).digest("hex");
const text=(value,max,required=false)=>{
 if(value!=null && typeof value!=="string")fail(400,"Invalid text.");
 const result=(value||"").trim();if(result.length>max || (required && !result))fail(400,"A required field is missing or too long.");return result;
};
export async function requireCustomer(verify,request,shop){
 if(!verify)throw new MobileApiError(503,"NOT_CONFIGURED","Customer authentication is unavailable.");
 const id=await verify(request,shop);
 if(!/^gid:\/\/shopify\/Customer\/\d+$/.test(id||""))throw new MobileApiError(401,"LOGIN_REQUIRED","Please sign in.");
 return id;
}
export function reviewImage(value){
 if(!value)return null;
 const image=text(value,200000,true);
 if(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))fail(400,"Upload a JPEG, PNG or WebP image.");
 return image;
}
const publicPost=record=>({id:record.id,...record.payload,time:record.createdAt,createdAt:record.createdAt,updatedAt:record.updatedAt,commentsCount:null,comments:[]});
const cursorFrom=request=>{
 const value=new URL(request.url).searchParams.get("cursor");
 if(value && !/^[a-zA-Z0-9_-]{1,100}$/.test(value))fail(400,"Invalid page cursor.");return value;
};
export async function reactionCounts(db,shop,targetType,ids){
 if(!ids.length)return new Map();
 if(!db.customerReaction?.groupBy)throw new MobileApiError(503,"NOT_CONFIGURED","Reactions are unavailable.");
 const rows=await db.customerReaction.groupBy({by:["targetId"],where:{shop,targetType,targetId:{in:ids},active:true},_count:{_all:true}});
 return new Map(rows.map(row=>[row.targetId,row._count._all]));
}
export async function customerCommunity({db,shop,request,verify,input}){
 if(input===undefined){
  const cursor=cursorFrom(request);
  const records=await db.customerRequest.findMany({where:{shop,type:"COMMUNITY_POST",status:{not:"CLOSED"},...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:"desc"},take:26,select:{id:true,payload:true,createdAt:true,updatedAt:true}});
  const visible=records.slice(0,25),counts=await reactionCounts(db,shop,"COMMUNITY_POST",visible.map(row=>row.id));
  return {posts:visible.map(row=>({...publicPost(row),likes:counts.get(row.id)||0})),nextCursor:records.length>25?visible.at(-1).id:null};
 }
 const customerId=await requireCustomer(verify,request,shop);
 const title=text(input.title,200,true),content=text(input.content,6000,true),author=text(input.author,100)||"회원";
 const tag=input.tag||"daily";if(!["recipes","reviews","daily","germany"].includes(tag))fail(400,"Invalid post category.");
 const refs=input.recipeMeta?.ingredients || [];
 if(!Array.isArray(refs) || refs.length>40)fail(400,"Invalid recipe ingredients.");
 const ingredients=refs.map(item=>{
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(item.productId||"") || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId||""))fail(400,"Choose actual product variants.");
  return {productId:item.productId,variantId:item.variantId};
 });
 const payload={title,content,author,location:text(input.location,100),tag,image:reviewImage(input.image),recipeMeta:tag==="recipes"?{ingredients,cookingTime:text(input.recipeMeta?.cookingTime,50),servings:text(input.recipeMeta?.servings,50),difficulty:text(input.recipeMeta?.difficulty,50),steps:Array.isArray(input.recipeMeta?.steps)?input.recipeMeta.steps.slice(0,30).map(step=>text(step,1000)):[]}:null};
 const record=await db.customerRequest.upsert({where:{requestKey:key([shop,"COMMUNITY_POST",customerId,payload])},create:{shop,customerId,type:"COMMUNITY_POST",requestKey:key([shop,"COMMUNITY_POST",customerId,payload]),payload},update:{},select:{id:true,payload:true,createdAt:true,updatedAt:true}});
 const counts=await reactionCounts(db,shop,"COMMUNITY_POST",[record.id]);
 return {accepted:true,post:{...publicPost(record),likes:counts.get(record.id)||0}};
}
export async function customerComments({db,shop,request,verify,input}){
 const postId=text(input?.postId || new URL(request.url).searchParams.get("postId"),100,true);
 const post=await db.customerRequest.findFirst({where:{id:postId,shop,type:"COMMUNITY_POST",status:{not:"CLOSED"}},select:{id:true}});
 if(!post)throw new MobileApiError(404,"NOT_FOUND","Post not found.");
 if(input===undefined){
  const cursor=cursorFrom(request);
  const where={shop,type:"COMMUNITY_COMMENT",status:{not:"CLOSED"},payload:{path:["postId"],equals:postId}};
  const [records,total]=await Promise.all([db.customerRequest.findMany({where:{...where,...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:"desc"},take:26,select:{id:true,payload:true,createdAt:true}}),db.customerRequest.count({where})]);
  const visible=records.slice(0,25);
  return {comments:visible.map(row=>({id:row.id,author:row.payload.author,text:row.payload.text,time:row.createdAt})),total,nextCursor:records.length>25?visible.at(-1).id:null};
 }
 const customerId=await requireCustomer(verify,request,shop),payload={postId,text:text(input.text,2000,true),author:text(input.author,100)||"회원"};
 const record=await db.customerRequest.upsert({where:{requestKey:key([shop,"COMMUNITY_COMMENT",customerId,payload])},create:{shop,customerId,type:"COMMUNITY_COMMENT",requestKey:key([shop,"COMMUNITY_COMMENT",customerId,payload]),payload},update:{},select:{id:true,createdAt:true}});
 return {accepted:true,comment:{id:record.id,author:payload.author,text:payload.text,time:record.createdAt}};
}
export async function customerReaction({db,shop,request,verify,input}){
 const customerId=await requireCustomer(verify,request,shop),targetId=text(input.targetId,100,true),targetType=input.targetType;
 if(!["COMMUNITY_POST","PHOTO_REVIEW"].includes(targetType) || typeof input.active!=="boolean")fail(400,"Invalid reaction.");
 const target=await db.customerRequest.findFirst({where:{id:targetId,shop,type:targetType,status:{not:"CLOSED"}},select:{id:true}});
 if(!target)throw new MobileApiError(404,"NOT_FOUND","Post not found.");
 if(!db.customerReaction?.upsert)throw new MobileApiError(503,"NOT_CONFIGURED","Reactions are unavailable.");
 const compound={shop,targetType,targetId,customerId};
 await db.customerReaction.upsert({where:{shop_targetType_targetId_customerId:compound},create:{...compound,active:input.active},update:{active:input.active}});
 const counts=await reactionCounts(db,shop,targetType,[targetId]);
 return {accepted:true,reviewId:targetId,targetId,likes:counts.get(targetId)||0,liked:input.active};
}
export async function customerRequestHistory({db,shop,request,verify}){
 const customerId=await requireCustomer(verify,request,shop),cursor=cursorFrom(request);
 const requestedId=new URL(request.url).searchParams.get("id");
 if(requestedId && !/^[a-zA-Z0-9_-]{1,100}$/.test(requestedId))fail(400,"Invalid request ID.");
 const type=new URL(request.url).searchParams.get("type"),types=["RETURN","SUPPORT","CLAIM","SUBSCRIPTION","ACCOUNT_DELETE"];
 if(type && type !== "B2B" && !types.includes(type))fail(400,"Invalid request type.");
 const [records,returnCount]=await Promise.all([db.customerRequest.findMany({where:{shop,customerId,type:type||{in:types},...(requestedId?{id:requestedId}:cursor?{id:{lt:cursor}}:{})},orderBy:{id:"desc"},take:26,select:{id:true,type:true,orderId:true,payload:true,status:true,createdAt:true,updatedAt:true}}),db.customerRequest.count({where:{shop,customerId,type:"RETURN"}})]);
 return {returnCount,requests:records.slice(0,25).map(row=>{const payload=row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? {...row.payload} : row.payload; if(payload && typeof payload === "object") delete payload.supportInternal; return {...row,payload};}),nextCursor:records.length>25?records[24].id:null};
}
export async function customerAttendance({db,shop,request,verify,input,loyalty}){
 const customerId=await requireCustomer(verify,request,shop);
 if(input===undefined){
  const records=await db.customerRequest.findMany({where:{shop,customerId,type:"ATTENDANCE"},orderBy:{createdAt:"desc"},take:400,select:{payload:true}});
  return {dates:records.map(row=>row.payload.date),rewardsAvailable:Boolean(loyalty?.configured()),policy:LOYALTY_POLICY};
 }
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const requestKey=key([shop,"ATTENDANCE",customerId,date]);
 const record=await db.customerRequest.upsert({where:{requestKey},create:{shop,customerId,type:"ATTENDANCE",requestKey,payload:{date}},update:{},select:{id:true}});
 const reward=await rewardClaim({db,loyalty,shop,customerId,subject:`attendance:${date}`,points:LOYALTY_POLICY.attendance,reason:"ATTENDANCE",note:`출석 적립 (${date})`});
 return {accepted:true,id:record.id,date,rewardsAvailable:Boolean(loyalty?.configured()),reward};
}
export async function customerDeleteRequest({db,shop,request,verify,input}){
 const customerId=await requireCustomer(verify,request,shop),reason=text(input.reason,1000,true),requestKey=key([shop,"ACCOUNT_DELETE",customerId]);
 const record=await db.customerRequest.upsert({where:{requestKey},create:{shop,customerId,type:"ACCOUNT_DELETE",requestKey,payload:{reason}},update:{},select:{id:true,status:true,createdAt:true}});
 return {accepted:true,requestId:record.id,status:record.status,submittedAt:record.createdAt};
}
