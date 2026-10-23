import test from "node:test";
import assert from "node:assert/strict";
import {
  validateImageFile,
  compressImageFile,
  SUPPORTED_IMAGE_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "../app/utils/imageCompressor.js";

test("SUPPORTED_IMAGE_TYPES includes PNG, JPEG, WEBP and GIF", () => {
  assert.ok(SUPPORTED_IMAGE_TYPES.includes("image/png"));
  assert.ok(SUPPORTED_IMAGE_TYPES.includes("image/jpeg"));
  assert.ok(SUPPORTED_IMAGE_TYPES.includes("image/webp"));
  assert.ok(SUPPORTED_IMAGE_TYPES.includes("image/gif"));
});

test("validateImageFile rejects missing file", () => {
  const result = validateImageFile(null);
  assert.equal(result.valid, false);
  assert.match(result.error, /파일이 선택되지 않았습니다/);
});

test("validateImageFile rejects unsupported mime types", () => {
  const pdfFile = { type: "application/pdf", size: 1024, name: "doc.pdf" };
  const exeFile = { type: "application/x-msdownload", size: 5000, name: "app.exe" };
  const txtFile = { type: "text/plain", size: 200, name: "info.txt" };

  assert.equal(validateImageFile(pdfFile).valid, false);
  assert.equal(validateImageFile(exeFile).valid, false);
  assert.equal(validateImageFile(txtFile).valid, false);
});

test("validateImageFile rejects files exceeding maximum size limit", () => {
  const hugeFile = {
    type: "image/png",
    size: MAX_FILE_SIZE_BYTES + 1024,
    name: "huge.png",
  };
  const result = validateImageFile(hugeFile);
  assert.equal(result.valid, false);
  assert.match(result.error, /파일 크기가 너무 큽니다/);
});

test("validateImageFile accepts valid image types within size limit", () => {
  const pngFile = { type: "image/png", size: 500 * 1024, name: "banner.png" };
  const jpgFile = { type: "image/jpeg", size: 1.5 * 1024 * 1024, name: "banner.jpg" };
  const webpFile = { type: "image/webp", size: 100 * 1024, name: "banner.webp" };

  assert.equal(validateImageFile(pngFile).valid, true);
  assert.equal(validateImageFile(jpgFile).valid, true);
  assert.equal(validateImageFile(webpFile).valid, true);
});

test("compressImageFile gracefully rejects when window is unavailable in Node", async () => {
  const dummyFile = { type: "image/png", size: 500, name: "test.png" };
  await assert.rejects(
    () => compressImageFile(dummyFile),
    /브라우저 환경에서만/
  );
});
