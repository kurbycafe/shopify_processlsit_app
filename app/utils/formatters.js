import dayjs from "dayjs";
import { DEFAULT_CURRENCY } from "../constants/shopify.js";

export function formatCurrency(amount, currencyCode = DEFAULT_CURRENCY) {
  const num = typeof amount === "number" ? amount : parseFloat(amount || "0");
  const validNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currencyCode || DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(validNum);
}

export function formatNumber(num) {
  const n = typeof num === "number" ? num : parseFloat(num || "0");
  const valid = isNaN(n) ? 0 : n;
  return new Intl.NumberFormat("de-DE").format(valid);
}

export function formatDate(date) {
  if (!date) return "-";
  return dayjs(date).format("DD.MM.YYYY");
}

export function formatDateTime(date) {
  if (!date) return "-";
  return dayjs(date).format("DD.MM.YYYY HH:mm");
}
