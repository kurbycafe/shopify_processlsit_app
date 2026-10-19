export function formatTaxPercent(value) {
  const number=Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("de-DE",{maximumFractionDigits:4}).format(number) : "미확인";
}
export function taxRateOptions(current, original=current, breakdown) {
  const rates=[...new Set([0,7,19,original,current].filter(value=>typeof value==="number"&&Number.isFinite(value)))];
  const mixed=breakdown && Object.keys(breakdown).length>1;
  return rates.map(rate=>({ value:String(rate),label:`${formatTaxPercent(rate)}%${mixed&&rate===original?" (실제 혼합 세율)":""}` }));
}
