import { MobileApiError, readId } from "./mobileApi.server.js";
import { customerShop } from "./customerApi.server.js";
export const SUBSCRIPTION_CUSTOMER_QUERY = `query SubscriptionCustomer { customer { id emailAddress { emailAddress } } }`;
const DEFAULT_ORIGINS = "https://dawayo.de,https://www.dawayo.de,capacitor://localhost,http://localhost,https://localhost,http://localhost:5173,http://127.0.0.1:5173,https://dawayo-mobile-app.vercel.app";
async function readBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new MobileApiError(415,"JSON_REQUIRED","JSON is required.");
  const reader=request.body?.getReader();
  if (!reader) throw new MobileApiError(400,"INVALID_INPUT","Request body is required.");
  let bytes=0;const chunks=[];
  try {
    for (;;) { const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();throw new MobileApiError(413,"PAYLOAD_TOO_LARGE","Request is too large.");}chunks.push(value); }
  } finally { reader.releaseLock(); }
  try { const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!input||Array.isArray(input)||typeof input!=="object")throw Error();return input; }
  catch { throw new MobileApiError(400,"INVALID_INPUT","Invalid JSON."); }
}
export function createLegacySubscriptionHandler({ resolve, customerQuery, cancel, env=process.env }) {
 return async ({request})=>{
  const headers={"Cache-Control":"private, no-store",Vary:"Origin","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type, X-Shop-Domain, X-Requested-With"};
  try {
    const origin=request.headers.get("origin");
    const allowed=(env.CUSTOMER_API_ALLOWED_ORIGINS || (env===process.env?DEFAULT_ORIGINS:"")).split(",").map(x=>x.trim()).filter(Boolean);
    if(origin&&!allowed.includes(origin))throw new MobileApiError(403,"ORIGIN_NOT_ALLOWED","Origin not allowed.");
    if(origin)headers["Access-Control-Allow-Origin"]=origin;
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
    const shop=customerShop(env);
    if(request.method==="GET") {
      const search=new URL(request.url).searchParams;
      const variantId=readId(search.get("variantId"),"ProductVariant");
      const url=new URL(request.url);url.search="";url.searchParams.set("variantId",variantId);
      const data=await resolve({request:new Request(url,{headers:request.headers}),resource:"restock",shop});
      return Response.json({success:true,data:{variantId,etaDate:data.estimatedDate,etaSource:data.source||null,scheduleStatus:data.scheduleStatus}}, {headers});
    }
    if(request.method!=="POST")throw new MobileApiError(405,"METHOD_NOT_ALLOWED","Unsupported request method.");
    const input=await readBody(request);
    const variantId=readId(input.variantId,"ProductVariant");
    if((input.intent||"subscribe")==="unsubscribe") {
      const customer=await customerQuery(request,shop,SUBSCRIPTION_CUSTOMER_QUERY);
      const email=customer.emailAddress?.emailAddress?.trim().toLowerCase();
      if(!email)throw new MobileApiError(401,"LOGIN_REQUIRED","본인 고객 계정으로 로그인한 뒤 알림을 취소해 주세요.");
      // Neither posted email nor subscriptionId can authorize cancellation of another customer's alerts.
      const result=await cancel({shop,email,variantId});
      return Response.json({success:true,message:"본인 계정의 재입고 알림 신청을 취소했습니다.",data:{count:result.count}}, {headers});
    }
    if(input.intent&&input.intent!=="subscribe")throw new MobileApiError(400,"INVALID_INPUT","Invalid action.");
    if(input.channel && input.channel!=="EMAIL")throw new MobileApiError(503,"CHANNEL_UNAVAILABLE","현재 이메일 재입고 알림만 지원합니다.");
    const payload={variantId,email:input.email};
    const forwarded=new Request(request.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await resolve({request:forwarded,resource:"restock-subscription",shop});
    if(data?.accepted!==true)throw new MobileApiError(503,"SUBSCRIPTION_UNAVAILABLE","신청을 저장하지 못했습니다.");
    return Response.json({success:true,data,message:"이메일 재입고 알림 신청을 저장했습니다."},{headers});
  }catch(error){
    const known=error instanceof MobileApiError;
    const status=known?error.status:503;
    if(status===401)headers["WWW-Authenticate"]="Bearer";
    return Response.json({success:false,error:{code:known?error.code:"SERVICE_UNAVAILABLE",message:known?error.message:"서비스를 이용할 수 없습니다. 다시 시도해 주세요."}},{status,headers});
  }
 };
}
