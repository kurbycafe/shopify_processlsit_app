import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import { expiryInfo } from "../utils/productExpiry.js";
import { TEMPERATURE_LABELS } from "../utils/productTemperatures.js";
const ENDPOINT = "/app/product-expiry";
const FILTERS = [{label:"전체",value:"all"},{label:"유통기한 미등록",value:"unset"},{label:"기한 임박",value:"near"},{label:"기한 경과",value:"expired"},{label:"형식 확인 필요",value:"invalid"},{label:"날짜 등록됨",value:"dated"}];
async function resultJson(response) {
 let data;
 try { data = await response.json(); } catch { throw Error("서버 응답을 확인하지 못했습니다. 새로고침해주세요."); }
 if (!response.ok || data.success !== true) {
  const error = Error(data.message || "유통기한을 처리하지 못했습니다.");
  error.status = response.status; error.details = data.details; throw error;
 }
 return data;
}
export default function ProductExpiryManager() {
 const [items,setItems]=useState([]),[status,setStatus]=useState("loading"),[reload,setReload]=useState(0);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[nearDays,setNearDays]=useState("30"),[stockOnly,setStockOnly]=useState(false);
 const [page,setPage]=useState(1),[selected,setSelected]=useState([]),[targetDate,setTargetDate]=useState("");
 const [error,setError]=useState(""),[success,setSuccess]=useState(""),[saving,setSaving]=useState(false),[progress,setProgress]=useState(null);
 const running=useRef(false),saveAbort=useRef(null),editor=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();let current=true;
  setItems([]);setStatus("loading");setSelected([]);setError("");setSuccess("");setPage(1);
  void(async()=>{
   const rows=new Map(),cursors=new Set();let after=null;
   try {
    do {
     const data=await resultJson(await fetch(ENDPOINT+(after?"?after="+encodeURIComponent(after):""),{signal:controller.signal,cache:"no-store",credentials:"same-origin",headers:{Accept:"application/json"}}));
     if(!Array.isArray(data.items)||typeof data.pageInfo?.hasNextPage!=="boolean")throw Error("상품 목록 응답이 올바르지 않습니다.");
     for(const item of data.items){if(!item.id||typeof item.title!=="string")throw Error("상품 정보가 올바르지 않습니다.");rows.set(item.id,item);}
     if(!current)return;setItems([...rows.values()]);
     if(!data.pageInfo.hasNextPage)break;
     const next=data.pageInfo.endCursor;if(!next||cursors.has(next))throw Error("다음 상품 페이지를 확인하지 못했습니다.");
     cursors.add(next);after=next;
    }while(current);
    if(current)setStatus("ready");
   }catch(err){if(current&&err.name!=="AbortError"){setStatus("error");setError(err.message);}}
  })();
  return()=>{current=false;controller.abort();};
 },[reload]);
 useEffect(()=>()=>saveAbort.current?.abort(),[]);
 const deferredQuery = useDeferredValue(query);
 const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
 const rows=useMemo(()=>items.map(item=>({...item,expiry:expiryInfo(item.expiryRaw,today)})),[items,today]);
 const filtered=useMemo(()=>{
  const term=deferredQuery.trim().toLowerCase();
  return rows.filter(item=>{
   if(term&&![item.title,item.sku,item.id].some(value=>String(value||"").toLowerCase().includes(term)))return false;
   if(stockOnly&&!(item.inventory>0))return false;
   const info=item.expiry;
   if(filter==="near")return info.days!==null&&info.days>=0&&info.days<=Number(nearDays);
   if(filter==="dated")return Boolean(info.date);
   return filter==="all"||info.status===filter;
  }).sort((a,b)=>(a.expiry.date||"9999-99-99").localeCompare(b.expiry.date||"9999-99-99")||a.title.localeCompare(b.title));
 },[rows,deferredQuery,filter,stockOnly,nearDays]);
 const pageCount=Math.max(1,Math.ceil(filtered.length/50)),currentPage=Math.min(page,pageCount);
 const visible=filtered.slice((currentPage-1)*50,currentPage*50),checked=visible.filter(item=>selected.includes(item.id)).length;
 const busy=saving||status!=="ready";
 const reset=()=>{setSelected([]);setError("");setSuccess("");setPage(1);};
 const save=async()=>{
  if(running.current||busy||!selected.length||!targetDate)return;
  const ids=[...selected],completed=new Set();let active=[];
  const controller=new AbortController();saveAbort.current=controller;running.current=true;
  setSaving(true);setError("");setSuccess("");setProgress({completed:0,total:ids.length});
  try{
   for(let offset=0;offset<ids.length;offset+=25){
    active=ids.slice(offset,offset+25);
    const data=await resultJson(await fetch(ENDPOINT,{method:"POST",credentials:"same-origin",signal:controller.signal,headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({productIds:active,expiryDate:targetDate})}));
    if(data.updatedCount!==active.length||data.expiryDate!==targetDate||!data.saveId||!Array.isArray(data.productIds)||active.some(id=>!data.productIds.includes(id)))throw Error("저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.");
    for(const id of active)completed.add(id);
    setItems(previous=>previous.map(item=>completed.has(item.id)?{...item,expiryDate:targetDate,expiryRaw:targetDate,expiryUncertain:false}:item));
    setSelected(previous=>previous.filter(id=>!completed.has(id)));setProgress({completed:completed.size,total:ids.length});
   }
   setSuccess(completed.size+"개 상품의 유통기한을 "+targetDate+"로 저장했습니다.");
  }catch(err){
   if(err.name!=="AbortError"){
    if(!err.status||err.status>=500||err.details?.uncertainProductIds?.length){
     const unknown=new Set(err.details?.uncertainProductIds||active);
     setItems(previous=>previous.map(item=>unknown.has(item.id)?{...item,expiryUncertain:true}:item));
    }
    setError((completed.size?completed.size+"개 저장 완료. 남은 "+(ids.length-completed.size)+"개는 선택 상태를 유지합니다. ":"")+err.message);
   }
  }finally{running.current=false;if(!controller.signal.aborted){setSaving(false);setProgress(null);}}
 };
 const dateBadge=item=>{
  const info=item.expiry;
  if(item.expiryUncertain)return <Badge tone="attention">저장 결과 확인 필요</Badge>;
  if(info.status==="unset")return <Badge>미등록</Badge>;
  if(info.status==="invalid")return <BlockStack gap="100"><Badge tone="attention">형식 확인</Badge><Text as="p" tone="subdued">{info.raw}</Text></BlockStack>;
  return <BlockStack gap="100"><Text as="p" fontWeight="semibold">{info.date}</Text><Badge tone={info.status==="expired"?"critical":info.days<=Number(nearDays)?"attention":"success"}>{info.days<0?Math.abs(info.days)+"일 경과":info.days===0?"오늘까지":info.days+"일 남음"}</Badge></BlockStack>;
 };
 return <BlockStack gap="400">
  <Card><BlockStack gap="300">
   <InlineStack align="space-between" gap="200"><BlockStack gap="100"><Text as="h2" variant="headingMd">유통기한 관리 (MHD)</Text><Text as="p" tone="subdued">상품별 실제 유통기한을 확인하고 날짜를 수정합니다. 출고 명세서·상품 라벨과 같은 Shopify 원본을 사용합니다.</Text></BlockStack><Button disabled={saving} loading={status==="loading"} onClick={()=>setReload(value=>value+1)}>유통기한 새로고침</Button></InlineStack>
   <InlineStack gap="200"><Badge>{"조회 상품 "+items.length+"개"}</Badge><Badge>{"미등록 "+rows.filter(item=>item.expiry.status==="unset").length+"개"}</Badge><Badge tone="critical">{"기한 경과 "+rows.filter(item=>item.expiry.status==="expired").length+"개"}</Badge><Badge tone="attention">{"기한 임박 "+rows.filter(item=>item.expiry.days!==null&&item.expiry.days>=0&&item.expiry.days<=Number(nearDays)).length+"개"}</Badge></InlineStack>
   {status==="loading"&&<p role="status">전체 상품의 유통기한을 조회하고 있습니다. 완료 후 수정할 수 있습니다.</p>}
   {status==="error"&&<Banner tone="critical"><p>조회가 완료되지 않아 목록이 일부일 수 있습니다. 다시 조회해주세요.</p></Banner>}
   <InlineStack gap="300"><div style={{flex:2,minWidth:200}}><TextField label="유통기한 상품 검색" value={query} disabled={saving} onChange={value=>{setQuery(value);reset();}} autoComplete="off" placeholder="상품 이름 · SKU · Product ID"/></div><div style={{flex:1,minWidth:150}}><Select label="유통기한 상태" value={filter} options={FILTERS} disabled={saving} onChange={value=>{setFilter(value);reset();}}/></div><Select label="임박 기준" value={nearDays} disabled={saving} options={["7","14","30","60","90"].map(value=>({label:value+"일 이내",value}))} onChange={value=>{setNearDays(value);reset();}}/></InlineStack>
   <Checkbox label="재고가 있는 상품만" checked={stockOnly} disabled={saving} onChange={value=>{setStockOnly(value);reset();}}/>
   <Text as="p" tone="subdued">유통기한이 빠른 순으로 표시합니다. 등록되지 않은 날짜는 추정하지 않습니다. 원본: freshly.expiry_date.</Text>
  </BlockStack></Card>
  {error&&<Banner tone="critical"><p>{error} 완료되지 않은 상품은 선택 상태를 유지합니다.</p></Banner>}
  {success&&<Banner tone="success"><p role="status">{success}</p></Banner>}
  <Card><BlockStack gap="300">
   <InlineStack align="space-between" gap="200" blockAlign="center"><Text as="h3" variant="headingSm">{selected.length+"개 상품 선택됨"}</Text><InlineStack gap="200"><Button disabled={busy||!filtered.length} onClick={()=>{setSelected(filtered.map(item=>item.id));setError("");setSuccess("");}}>{"검색 결과 전체 "+filtered.length+"개 선택"}</Button><Button disabled={busy||!selected.length} onClick={reset}>선택 해제</Button></InlineStack></InlineStack>
   <div ref={editor}><InlineStack gap="200" blockAlign="end"><TextField label="변경할 유통기한" type="date" value={targetDate} disabled={busy} onChange={setTargetDate} autoComplete="off"/><Button variant="primary" loading={saving} disabled={busy||!selected.length||!targetDate} onClick={save}>선택 상품 유통기한 저장</Button></InlineStack></div>
   <Text as="p" tone="subdued">{selected.length&&targetDate?selected.length+"개 상품의 날짜를 "+targetDate+"로 변경합니다. ":""}날짜 변경은 Shopify에 저장되어 기존 유통기한을 교체합니다. 판매가격·재고·특가 여부는 변경하지 않습니다.</Text>
   {progress&&<p role="status">{"유통기한 저장 중 "+progress.completed+" / "+progress.total+"개"}</p>}
   <div style={{overflowX:"auto"}}><table style={{width:"100%",minWidth:760,borderCollapse:"collapse"}}>
    <thead><tr style={{textAlign:"left",borderBottom:"2px solid #d2d5d8"}}><th style={{padding:12}}><Checkbox label="유통기한 현재 페이지 전체 선택" labelHidden disabled={busy||!visible.length} checked={visible.length&&checked===visible.length?true:checked?"indeterminate":false} onChange={value=>setSelected(previous=>value?[...new Set([...previous,...visible.map(item=>item.id)])]:previous.filter(id=>!visible.some(item=>item.id===id)))}/></th><th style={{padding:12}}>사진 · 상품 이름</th><th style={{padding:12}}>재고</th><th style={{padding:12}}>온도</th><th style={{padding:12}}>유통기한 · 남은 일수</th><th style={{padding:12}}>수정</th></tr></thead>
    <tbody>{visible.map(item=><tr key={item.id} style={{borderBottom:"1px solid #e1e3e5",background:selected.includes(item.id)?"#eef6ff":"transparent"}}>
     <td style={{padding:12}}><Checkbox label={item.title+" 유통기한 선택"} labelHidden checked={selected.includes(item.id)} disabled={busy} onChange={value=>setSelected(previous=>value?[...new Set([...previous,item.id])]:previous.filter(id=>id!==item.id))}/></td>
     <td style={{padding:12}}><InlineStack gap="200" blockAlign="center">{item.imageUrl?<img src={item.imageUrl} alt="" width="48" height="48" loading="lazy" style={{objectFit:"contain"}}/>:<span>사진 없음</span>}<BlockStack gap="100"><Text as="p" fontWeight="semibold">{item.title}</Text><Text as="p" tone="subdued">{item.sku||"SKU 없음"}{" · ID "+item.id.split("/").pop()}</Text></BlockStack></InlineStack></td>
     <td style={{padding:12,whiteSpace:"nowrap"}}>{item.tracksInventory?item.inventory===null?"확인 불가":item.inventory.toLocaleString("ko-KR")+"개":"추적 안 함"}</td>
     <td style={{padding:12}}>{item.storageTemp&&<Badge>{TEMPERATURE_LABELS[item.storageTemp]}</Badge>}</td>
     <td style={{padding:12}}>{dateBadge(item)}</td>
     <td style={{padding:12}}><Button disabled={busy} accessibilityLabel={item.title+" 유통기한 수정"} onClick={()=>{setSelected([item.id]);setTargetDate(item.expiry.date);setError("");setSuccess("");editor.current?.scrollIntoView({behavior:"smooth",block:"center"});}}>수정</Button></td>
    </tr>)}</tbody>
   </table></div>
   {!visible.length&&<p role="status">{status==="loading"?"상품을 불러오는 중입니다.":"조건에 맞는 상품이 없습니다."}</p>}
   <InlineStack align="space-between" blockAlign="center"><Text as="p">{filtered.length+"개 상품 · "+currentPage+" / "+pageCount+"페이지"}</Text><InlineStack gap="200"><Button disabled={busy||currentPage<=1} onClick={()=>setPage(currentPage-1)}>이전</Button><Button disabled={busy||currentPage>=pageCount} onClick={()=>setPage(currentPage+1)}>다음</Button></InlineStack></InlineStack>
  </BlockStack></Card>
 </BlockStack>;
}
