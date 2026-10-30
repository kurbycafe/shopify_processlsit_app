import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Prints the customer invoice page (the same Rechnung process-list prints) to a
// PDF with headless Chromium, so the customer's file looks exactly like it.
const FONT_DIR = path.join(process.cwd(), "app", "assets", "fonts");
const LOCAL_BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

async function launchOptions() {
  if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const executablePath = LOCAL_BROWSERS.find((candidate) => existsSync(candidate));
    if (!executablePath) throw new Error("No local Chrome for invoice PDFs");
    return { executablePath, headless: true, args: ["--no-sandbox"] };
  }
  const { default: chromium } = await import("@sparticuz/chromium");
  const executablePath = await chromium.executablePath();
  // The bundled fonts have no Hangul; Korean product names need Pretendard.
  const fonts = path.join(tmpdir(), "fonts");
  await mkdir(fonts, { recursive: true });
  await Promise.all(["Pretendard-Regular.ttf", "Pretendard-Bold.ttf"].map((file) => copyFile(path.join(FONT_DIR, file), path.join(fonts, file))));
  return { executablePath, headless: true, args: chromium.args };
}

export async function renderInvoicePagePdf(url) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch(await launchOptions());
  try {
    const page = await browser.newPage();
    // The page opens the print dialog for people; here it would only block.
    await page.evaluateOnNewDocument(() => { window.print = () => {}; });
    const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });
    if (!response?.ok()) throw new Error(`Invoice page returned ${response?.status()}`);
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
