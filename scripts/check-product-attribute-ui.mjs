import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { listAttributeProducts, saveProductAttributes } from "../app/services/productAttributes.server.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const productId = n => "gid://shopify/Product/" + n;
const products = Array.from({ length: 305 }, (_, i) => ({
 id: productId(i + 1), title: "테스트 상품 " + String(i + 1).padStart(3, "0"),
 totalInventory: i, tracksInventory: true, variants: { nodes: [{ sku: "SKU-" + String(i + 1).padStart(3, "0") }] },
 featuredMedia: { preview: { image: { url: "/attribute-test-image.svg" } } }, producttype: i % 4 ? { value: ["t", "k", "tk"][i % 3] } : null,
}));
let record = { id: "test", shop: "test.myshopify.com", updatedAt: new Date(1000),
 tickersJson: { customSetting: "keep", productOverrides: [
  { id: "one", productId: productId(1), isMhdDeal: true, mhdDate: "2027-01-01", mhdPrice: 2.9, bundleBadgeDe: "Behalten" },
  { id: "two", productId: productId(2), isUpcomingDeal: true, upcomingDateKo: "금요일 18시" },
  { id: "three", productId: productId(3), ageRestriction: "18+", pfand: .25 },
 ] } };
const db = { mobileStorefrontConfig: {
 findUnique: async () => structuredClone(record),
 updateMany: async ({ where, data }) => { assert.equal(where.updatedAt.getTime(), record.updatedAt.getTime()); record = { ...record, ...structuredClone(data), updatedAt: new Date(record.updatedAt.getTime() + 1) }; return { count: 1 }; },
} };
const admin = { graphql: async (query, { variables }) => {
 assert.ok(!query.includes("mutation"));
 if (variables.ids) return Response.json({ data: { nodes: variables.ids.map(id => products.find(product => product.id === id)) } });
 const start = Number(variables.after || 0), end = Math.min(start + 100, products.length);
 return Response.json({ data: { products: { nodes: products.slice(start, end), pageInfo: { hasNextPage: end < products.length, endCursor: end < products.length ? String(end) : null } } } });
} };
const files = [path.resolve("attribute-ui-check.html"), path.resolve("attribute-ui-check.jsx")];
const owned = [], errors = [], requests = [];
let server, browser, page, failAt = 0, saveRequests = 0;
try {
 for (const file of files) if (fs.existsSync(file)) throw Error("A UI check file already exists.");
 fs.writeFileSync(files[0], '<html><head><meta charset="utf-8"></head><body style="margin:24px;background:#f4f5f6"><div id="root"></div><script type="module" src="/attribute-ui-check.jsx"></script></body></html>'); owned.push(files[0]);
 fs.writeFileSync(files[1], 'import React from "react";import {createRoot} from "react-dom/client";import {AppProvider} from "@shopify/polaris";import en from "@shopify/polaris/locales/en.json";import "@shopify/polaris/build/esm/styles.css";import Manager from "./app/components/ProductAttributesManager.jsx";createRoot(document.getElementById("root")).render(<AppProvider i18n={en}><Manager/></AppProvider>);'); owned.push(files[1]);
 server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/node_modules/**", "**/android/**"] } } });
 await server.listen(); browser = await chromium.launch({ channel: "chrome", headless: true });
 page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
 page.on("pageerror", error => errors.push(error.message));
 await page.route("**/attribute-test-image.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#e2e8f0"/><rect x="12" y="8" width="24" height="32" rx="4" fill="#e30613"/></svg>' }));
 await page.route("**/app/product-attributes*", async route => {
  const request = route.request();
  try {
   if (request.method() === "POST") {
    const input = request.postDataJSON(); requests.push(input); saveRequests++;
    if (saveRequests === failAt) { failAt = 0; return route.fulfill({ status: 503, json: { success: false, message: "테스트 저장 실패" } }); }
    return route.fulfill({ json: await saveProductAttributes({ admin, db, shop: "test.myshopify.com", input }) });
   }
   return route.fulfill({ json: await listAttributeProducts({ admin, db, shop: "test.myshopify.com", after: new URL(request.url()).searchParams.get("after") }) });
  } catch (error) { return route.fulfill({ status: error.status || 503, json: { success: false, message: error.message } }); }
 });
 await page.goto("http://127.0.0.1:" + server.httpServer.address().port + "/attribute-ui-check.html");
 await page.getByText("조회 상품 305개", { exact: true }).waitFor();
 await page.waitForFunction(() => !document.body.innerText.includes("전체 상품을 조회하고 있습니다."));
 await page.getByLabel("상품 속성 필터", { exact: true }).selectOption("unset");
 await page.getByRole("button", { name: "테스트 상품 004 속성 수정", exact: true }).click();
 await page.getByLabel("MHD 날짜 변경", { exact: true }).check();
 await page.getByLabel("MHD 날짜", { exact: true }).fill("2027-06-01");
 await page.getByLabel("무료배송 채우기 추천 변경", { exact: true }).check();
 await page.getByLabel("무료배송 채우기 추천", { exact: true }).selectOption("true");
 await page.getByRole("button", { name: "선택한 속성 저장", exact: true }).click();
 await page.getByText("1개 상품의 선택한 속성을 저장했습니다.", { exact: true }).waitFor();
 assert.equal(await page.getByLabel("테스트 상품 004 속성 선택", { exact: true }).count(), 0);
 assert.equal(record.tickersJson.productOverrides.find(rule => rule.productId === productId(4)).mhdDate, "2027-06-01");
 await page.getByLabel("상품 속성 필터", { exact: true }).selectOption("mhd");
 await page.getByLabel("속성 상품 검색", { exact: true }).fill("SKU-001");
 await page.getByRole("button", { name: "테스트 상품 001 속성 수정", exact: true }).click();
 assert.equal(await page.getByLabel("MHD 날짜", { exact: true }).inputValue(), "2027-01-01");
 await page.getByLabel("무료배송 채우기 추천 변경", { exact: true }).check();
 await page.getByLabel("무료배송 채우기 추천", { exact: true }).selectOption("true");
 await page.getByRole("button", { name: "선택한 속성 저장", exact: true }).click();
 await page.getByText("1개 상품의 선택한 속성을 저장했습니다.", { exact: true }).waitFor();
 const one = record.tickersJson.productOverrides.find(rule => rule.productId === productId(1));
 assert.equal(one.mhdDate,"2027-01-01"); assert.equal(one.mhdPrice,2.9); assert.equal(one.bundleBadgeDe,"Behalten");
 await page.getByLabel("속성 상품 검색", { exact: true }).fill("");
 await page.getByLabel("상품 속성 필터", { exact: true }).selectOption("all");
 await page.getByLabel("속성 현재 페이지 전체 선택", { exact: true }).check();
 await page.getByRole("button", { name: "다음", exact: true }).click();
 await page.getByText("50개 상품 선택됨", { exact: true }).waitFor();
 await page.getByLabel("속성 현재 페이지 전체 선택", { exact: true }).check();
 await page.getByText("100개 상품 선택됨", { exact: true }).waitFor();
 await page.getByLabel("속성 현재 페이지 전체 선택", { exact: true }).uncheck();
 await page.getByText("50개 상품 선택됨", { exact: true }).waitFor();
 await page.getByRole("button", { name: "검색 결과 전체 305개 선택", exact: true }).click();
 await page.getByRole("button", { name: "선택 상품 속성 수정", exact: true }).click();
 await page.getByLabel("무료배송 채우기 추천 변경", { exact: true }).check();
 await page.getByLabel("무료배송 채우기 추천", { exact: true }).selectOption("true");
 const beforeAll = requests.length;
 await page.getByRole("button", { name: "선택한 속성 저장", exact: true }).click();
 await page.getByText("305개 상품의 선택한 속성을 저장했습니다.", { exact: true }).waitFor();
 assert.equal(requests.length - beforeAll,4); assert.ok(requests.slice(beforeAll).every(input => input.productIds.length <= 100));
 assert.ok(record.tickersJson.productOverrides.every(rule => rule.isCartFiller));
 assert.equal(record.tickersJson.customSetting,"keep");
 await page.getByRole("button", { name: "검색 결과 전체 305개 선택", exact: true }).click();
 await page.getByRole("button", { name: "선택 상품 속성 수정", exact: true }).click();
 await page.getByLabel("오픈예정 변경", { exact: true }).check();
 await page.getByLabel("오픈예정", { exact: true }).selectOption("true");
 failAt = saveRequests + 2;
 await page.getByRole("button", { name: "선택한 속성 저장", exact: true }).click();
 await page.getByRole("alert").filter({ hasText: "100개 저장 완료. 남은 205개" }).waitFor();
 await page.getByText("205개 상품 선택됨", { exact: true }).waitFor();
 const beforeRetry = requests.length;
 await page.getByRole("button", { name: "선택한 속성 저장", exact: true }).click();
 await page.getByText("205개 상품의 선택한 속성을 저장했습니다.", { exact: true }).waitFor();
 assert.equal(requests.length - beforeRetry,3); assert.ok(record.tickersJson.productOverrides.every(rule=>rule.isUpcomingDeal));
 await page.getByRole("button", { name: "이전", exact: true }).click();
 if (process.env.ATTRIBUTE_UI_SCREENSHOT) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: process.env.ATTRIBUTE_UI_SCREENSHOT });
  await page.getByRole("button", { name: "테스트 상품 001 속성 수정", exact: true }).click();
  await page.getByRole("heading", { name: "선택 상품 일괄 편집", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: process.env.ATTRIBUTE_UI_SCREENSHOT.replace(".png", "-editor.png") });
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ passed:true, products:305, checks:["real service and DB fixture","unset filter","SKU search","single edit preserves unchecked MHD and locales","current-page select and unselect","cross-page selection","305 selected in four requests","partial save retains 205 pending","pending-only retry"],renderErrors:errors }));
} catch(error) {
 if(page)console.error(JSON.stringify({errors,body:(await page.locator("body").innerText()).slice(0,1600)}));
 throw error;
} finally {
 if(browser)await browser.close();
 if(server){server.httpServer?.closeAllConnections();await server.close();}
 for(const file of owned)if(fs.existsSync(file))fs.unlinkSync(file);
}
