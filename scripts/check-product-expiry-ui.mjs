import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { listExpiryProducts, saveProductExpiry } from "../app/services/productExpiry.server.js";
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
const date=days=>new Date(Date.parse(today+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);
const products=Array.from({length:305},(_,i)=>({id:"gid://shopify/Product/"+(i+1),title:"테스트 상품 "+String(i+1).padStart(3,"0"),totalInventory:i,tracksInventory:true,
 variants:{nodes:[{sku:"SKU-"+String(i+1).padStart(3,"0")}]},featuredMedia:{preview:{image:{url:"/expiry-image.svg"}}},producttype:{value:"k"},
 expiryDate:i%5===0?null:{value:i%5===1?date(-3):i%5===2?date(7):i%5===3?date(120):"날짜 확인",type:"date",compareDigest:"digest-"+i}}));
const admin={graphql:async(query,{variables})=>{
 if(variables.metafields){
  assert.ok(variables.metafields.length<=25);
  for(const field of variables.metafields){
   assert.equal(field.namespace,"freshly");assert.equal(field.key,"expiry_date");
   products.find(product=>product.id===field.ownerId).expiryDate={value:field.value,type:"date",compareDigest:"saved"};
  }
  return Response.json({data:{metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}}});
 }
 if(variables.ids)return Response.json({data:{nodes:variables.ids.map(id=>products.find(product=>product.id===id))}});
 const start=Number(variables.after||0),end=Math.min(start+100,products.length);
 return Response.json({data:{products:{nodes:products.slice(start,end),pageInfo:{hasNextPage:end<products.length,endCursor:end<products.length?String(end):null}}}});
}};
const files=[path.resolve("expiry-ui-check.html"),path.resolve("expiry-ui-check.jsx")],owned=[],errors=[],requests=[];
let server,browser,page,failAt=0,writes=0;
try{
 for(const file of files)if(fs.existsSync(file))throw Error("A UI harness already exists.");
 fs.writeFileSync(files[0],'<html><head><meta charset="utf-8"></head><body style="margin:24px;background:#f4f5f6"><div id="root"></div><script type="module" src="/expiry-ui-check.jsx"></script></body></html>');owned.push(files[0]);
 fs.writeFileSync(files[1],'import React from "react";import {createRoot} from "react-dom/client";import {AppProvider} from "@shopify/polaris";import en from "@shopify/polaris/locales/en.json";import "@shopify/polaris/build/esm/styles.css";import Manager from "./app/components/ProductExpiryManager.jsx";createRoot(document.getElementById("root")).render(<AppProvider i18n={en}><Manager/></AppProvider>);');owned.push(files[1]);
 server=await createServer({configFile:false,esbuild:{jsx:"automatic"},server:{host:"127.0.0.1",port:0,watch:{ignored:["**/node_modules/**","**/android/**"]}}});await server.listen();
 browser=await chromium.launch({headless:true,channel:"chrome"});page=await browser.newPage({viewport:{width:1280,height:980}});page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/expiry-image.svg",route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#e2e8f0"/><rect x="12" y="8" width="24" height="32" rx="4" fill="#e30613"/></svg>'}));
 await page.route("**/app/product-expiry*",async route=>{
  try{
   if(route.request().method()==="POST"){
    const input=route.request().postDataJSON();requests.push(input);writes++;
    if(writes===failAt){failAt=0;return route.fulfill({status:503,json:{success:false,message:"테스트 날짜 저장 실패"}});}
    return route.fulfill({json:await saveProductExpiry({admin,input})});
   }
   return route.fulfill({json:await listExpiryProducts({admin,after:new URL(route.request().url()).searchParams.get("after")})});
  }catch(error){return route.fulfill({status:error.status||503,json:{success:false,message:error.message,details:error.details}});}
 });
 await page.goto("http://127.0.0.1:"+server.httpServer.address().port+"/expiry-ui-check.html");
 await page.getByText("조회 상품 305개",{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.body.innerText.includes("전체 상품의 유통기한을 조회하고 있습니다."));
 await page.getByLabel("유통기한 상태",{exact:true}).selectOption("unset");
 await page.getByLabel("유통기한 상품 검색",{exact:true}).fill("SKU-001");
 await page.getByRole("button",{name:"테스트 상품 001 유통기한 수정",exact:true}).click();
 assert.equal(await page.getByLabel("변경할 유통기한",{exact:true}).inputValue(),"");
 await page.getByLabel("변경할 유통기한",{exact:true}).fill(date(40));
 await page.getByRole("button",{name:"선택 상품 유통기한 저장",exact:true}).click();
 await page.getByText("1개 상품의 유통기한을 "+date(40)+"로 저장했습니다.",{exact:true}).waitFor();
 assert.equal(products[0].expiryDate.value,date(40));assert.equal(await page.getByLabel("테스트 상품 001 유통기한 선택",{exact:true}).count(),0);
 await page.getByLabel("유통기한 상품 검색",{exact:true}).fill("");
 await page.getByLabel("유통기한 상태",{exact:true}).selectOption("near");
 await page.getByLabel("임박 기준",{exact:true}).selectOption("7");
 await page.getByText("61개 상품 · 1 / 2페이지",{exact:true}).waitFor();
 await page.getByLabel("유통기한 상태",{exact:true}).selectOption("expired");
 await page.getByText("61개 상품 · 1 / 2페이지",{exact:true}).waitFor();
 await page.getByText("3일 경과",{exact:true}).first().waitFor();
 await page.getByLabel("유통기한 상태",{exact:true}).selectOption("invalid");
 await page.getByText("날짜 확인",{exact:true}).first().waitFor();
 await page.getByLabel("유통기한 상태",{exact:true}).selectOption("all");
 await page.getByLabel("재고가 있는 상품만",{exact:true}).check();
 await page.getByText("검색 결과 전체 304개 선택",{exact:true}).waitFor();
 await page.getByLabel("재고가 있는 상품만",{exact:true}).uncheck();
 await page.getByRole("button",{name:"검색 결과 전체 305개 선택",exact:true}).click();
 await page.getByLabel("변경할 유통기한",{exact:true}).fill(date(60));
 const before=requests.length;
 await page.getByRole("button",{name:"선택 상품 유통기한 저장",exact:true}).click();
 await page.getByText("305개 상품의 유통기한을 "+date(60)+"로 저장했습니다.",{exact:true}).waitFor();
 assert.equal(requests.length-before,13);assert.ok(products.every(product=>product.expiryDate.value===date(60)));assert.ok(products.every(product=>product.producttype.value==="k"));
 await page.getByRole("button",{name:"검색 결과 전체 305개 선택",exact:true}).click();
 await page.getByLabel("변경할 유통기한",{exact:true}).fill(date(90));failAt=writes+2;
 await page.getByRole("button",{name:"선택 상품 유통기한 저장",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"25개 저장 완료. 남은 280개"}).waitFor();
 await page.getByText("280개 상품 선택됨",{exact:true}).waitFor();
 await page.getByRole("button",{name:"선택 상품 유통기한 저장",exact:true}).click();
 await page.getByText("280개 상품의 유통기한을 "+date(90)+"로 저장했습니다.",{exact:true}).waitFor();
 assert.ok(products.every(product=>product.expiryDate.value===date(90)));
 await page.evaluate(()=>window.scrollTo(0,0));
 if(process.env.EXPIRY_UI_SCREENSHOT)await page.screenshot({path:process.env.EXPIRY_UI_SCREENSHOT});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,products:305,checks:["Shopify source read/write via real service","unset SKU search and single date save","near threshold and expired filters","invalid raw review","in-stock filter","305 selections saved in 13 requests","partial failure retains 280 pending","pending retry"],renderErrors:errors}));
}catch(error){if(page)console.error(JSON.stringify({errors,body:(await page.locator("body").innerText()).slice(0,1300)}));throw error;}
finally{if(browser)await browser.close();if(server){server.httpServer?.closeAllConnections();await server.close();}for(const file of owned)if(fs.existsSync(file))fs.unlinkSync(file);}
