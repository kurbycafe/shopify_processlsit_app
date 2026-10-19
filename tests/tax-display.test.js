import test from "node:test";
import assert from "node:assert/strict";
import {formatTaxPercent,taxRateOptions} from "../app/utils/taxDisplay.js";
test("tax display removes floating point noise and preserves fractional VAT",()=>{
 assert.equal(formatTaxPercent(7.000000000000001),"7");assert.equal(formatTaxPercent(7.5),"7,5");
});
test("tax options preserve actual foreign and mixed rates when changing and restoring them",()=>{
 assert.ok(taxRateOptions(21).some(option=>option.value==="21"));
 const options=taxRateOptions(0,12.5,{7:.35,19:.61});assert.ok(options.some(option=>option.value==="12.5"&&option.label.includes("혼합")));
});
