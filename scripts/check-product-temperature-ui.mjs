import { saveProductTemperatures } from "../app/services/productTemperatures.server.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const files = [path.resolve("temperature-ui-check.html"), path.resolve("temperature-ui-check.jsx")];
const products = Array.from({ length: 305 }, (_, index) => ({
  id: "gid://shopify/Product/" + (index + 1), title: "테스트 상품 " + String(index + 1).padStart(3, "0"),
  imageUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect x='10' y='5' width='36' height='46' rx='4' fill='%23bee8d0'/%3E%3C/svg%3E",
  imageAlt: "Test product", inventory: index, tracksInventory: true,
  storageTemp: ["", "ambient", "chilled", "frozen"][index % 4],
}));
let vite, browser, page, failNext = false, partialNext = false;
const changes = [], errors = [], ownedFiles = [];
try {
  for (const file of files) if (fs.existsSync(file)) throw Error("A UI harness file already exists.");
  fs.writeFileSync(files[0], '<html><head><meta charset="utf-8" /></head><body style="margin:24px;background:#f4f5f6"><div id="root"></div><script type="module" src="/temperature-ui-check.jsx"></script></body></html>');
  ownedFiles.push(files[0]);
  fs.writeFileSync(files[1], 'import React from "react";import {createRoot} from "react-dom/client";import {AppProvider} from "@shopify/polaris";import en from "@shopify/polaris/locales/en.json";import "@shopify/polaris/build/esm/styles.css";import Manager from "./app/components/ProductTemperatureManager.jsx";createRoot(document.getElementById("root")).render(<AppProvider i18n={en}><Manager/></AppProvider>);');
  ownedFiles.push(files[1]);
  vite = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0,
    watch: { ignored: ["**/*.aab", "**/*.apk", "**/node_modules/**", "**/android/**", "**/ios/**"] } },
    optimizeDeps: { include: ["react", "react-dom/client", "@shopify/polaris"] } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/app/product-temperatures*", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      const input = request.postDataJSON(); changes.push(input);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { success: false, message: "테스트 저장 실패" } }); }
      let batchNumber = 0;
      const admin = { graphql: async (_query, { variables }) => {
        if (variables.ids) return Response.json({ data: { nodes: variables.ids.map(id => ({ id, producttype: null })) } });
        const fields = variables.metafields;
        assert.ok(fields.length <= 25);
        if (++batchNumber && partialNext && fields.some(field => field.ownerId === "gid://shopify/Product/26")) return Response.json({ data: { metafieldsSet: { userErrors: [{ code: "INVALID_COMPARE_DIGEST" }], metafields: [] } } });
        for (const field of fields) {
          const item = products.find(product => product.id === field.ownerId);
          item.storageTemp = { t: "ambient", k: "chilled", tk: "frozen" }[field.value];
        }
        return Response.json({ data: { metafieldsSet: { userErrors: [], metafields: fields.map(field => ({ ...field, owner: { id: field.ownerId } })) } } });
      } };
      try {
        const result = await saveProductTemperatures({ admin, input });
        return route.fulfill({ json: result });
      } catch (error) {
        partialNext = false;
        return route.fulfill({ status: error.status || 502, json: { success: false, message: error.message, details: error.details } });
      }
    }
    const start = Number(new URL(request.url()).searchParams.get("after") || 0);
    const end = Math.min(start + 100, products.length);
    return route.fulfill({ json: { success: true, items: products.slice(start, end), pageInfo: { hasNextPage: end < products.length, endCursor: end < products.length ? String(end) : null } } });
  });
  await page.goto("http://127.0.0.1:" + vite.httpServer.address().port + "/temperature-ui-check.html", { waitUntil: "domcontentloaded" });
  await page.getByText("조회 상품 305개", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Shopify 상품을 불러오는 중입니다."));
  await page.getByLabel("현재 보관 온도", { exact: true }).selectOption("unset");
  await page.getByLabel("테스트 상품 105 선택", { exact: true }).check();
  await page.getByLabel("변경할 온도", { exact: true }).selectOption("chilled");
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByText("1개 상품을 냉장으로 저장했습니다.", { exact: true }).waitFor();
  assert.deepEqual(changes[0], { productIds: ["gid://shopify/Product/105"], storageTemp: "chilled" });
  assert.equal(await page.getByLabel("테스트 상품 105 선택", { exact: true }).count(), 0);
  await page.getByLabel("현재 보관 온도", { exact: true }).selectOption("chilled");
  await page.getByLabel("상품 검색", { exact: true }).fill("105");
  await page.getByLabel("테스트 상품 105 선택", { exact: true }).waitFor();
  await page.getByLabel("상품 검색", { exact: true }).fill("");
  await page.getByLabel("현재 보관 온도", { exact: true }).selectOption("all");
  await page.getByLabel("현재 페이지 전체 선택", { exact: true }).check();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 50);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 0);
  await page.getByText("50개 선택됨", { exact: true }).waitFor();
  await page.getByLabel("상품 검색", { exact: true }).fill("001");
  await page.getByLabel("테스트 상품 001 선택", { exact: true }).check();
  await page.getByLabel("변경할 온도", { exact: true }).selectOption("frozen");
  failNext = true;
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "테스트 저장 실패" }).waitFor();
  assert.ok(await page.getByLabel("테스트 상품 001 선택", { exact: true }).isChecked());
  assert.equal(products[0].storageTemp, "");
  await page.getByLabel("상품 검색", { exact: true }).fill("");
  await page.getByLabel("현재 보관 온도", { exact: true }).selectOption("unset");
  await page.getByLabel("현재 보관 온도", { exact: true }).selectOption("all");
  await page.getByLabel("현재 페이지 전체 선택", { exact: true }).check();
  for (let index = 44; index <= 50; index++) await page.getByLabel("테스트 상품 " + String(index).padStart(3, "0") + " 선택", { exact: true }).uncheck();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 43);
  await page.getByLabel("변경할 온도", { exact: true }).selectOption("chilled");
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByText("43개 상품을 냉장으로 저장했습니다.", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 0);
  await page.getByLabel("현재 페이지 전체 선택", { exact: true }).check();
  for (let index = 44; index <= 50; index++) await page.getByLabel("테스트 상품 " + String(index).padStart(3, "0") + " 선택", { exact: true }).uncheck();
  partialNext = true;
  await page.getByLabel("변경할 온도", { exact: true }).selectOption("frozen");
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "25개 상품은 저장되었고 18개 상품 처리가 중단" }).waitFor();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 18);
  assert.equal(products[0].storageTemp, "frozen");
  assert.equal(products[25].storageTemp, "chilled");
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByText("18개 상품을 냉동으로 저장했습니다.", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 0);
  const requestsBeforeAll = changes.length;
  await page.getByRole("button", { name: "검색 결과 전체 305개 선택", exact: true }).click();
  await page.getByText("305개 선택됨", { exact: true }).waitFor();
  await page.getByLabel("변경할 온도", { exact: true }).selectOption("ambient");
  await page.getByRole("button", { name: "선택 상품 일괄 변경", exact: true }).click();
  await page.getByText("305개 상품을 상온으로 저장했습니다.", { exact: true }).waitFor();
  const allRequests = changes.slice(requestsBeforeAll);
  assert.equal(allRequests.length, 13);
  assert.ok(allRequests.every(change => change.productIds.length <= 25));
  assert.equal(new Set(allRequests.flatMap(change => change.productIds)).size, 305);
  assert.ok(products.every(product => product.storageTemp === "ambient"));
  if (process.env.TEMPERATURE_UI_SCREENSHOT) await page.screenshot({ path: process.env.TEMPERATURE_UI_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, catalogProducts: 305,
    checks: ["all cursor pages", "unset filter", "single selected save", "saved row exits unset filter", "search and temperature intersection", "current-page select all", "page selection preserved", "failed save retains selection and temperature", "43 selected real-service save", "partial batch keeps 18 pending selected", "pending-only retry", "all 305 selected saved in 13 short requests"], renderErrors: errors }));
} catch (error) {
  if (page) console.error(JSON.stringify({ renderErrors: errors, body: (await page.locator("body").innerText()).slice(0, 1300) }));
  throw error;
} finally {
  if (browser) await browser.close();
  if (vite) { vite.httpServer?.closeAllConnections(); await vite.close(); }
  for (const file of ownedFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
}
