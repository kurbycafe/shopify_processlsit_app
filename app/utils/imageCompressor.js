/**
 * Image compression and optimization utility for client-side banner and storefront uploads.
 * Automatically resizes large images and compresses to high-efficiency WebP format.
 */

export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB max raw upload

/**
 * Validates whether an uploaded File is a supported image within reasonable size.
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: "파일이 선택되지 않았습니다." };
  }
  if (!file.type || !SUPPORTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: "지원하지 않는 파일 형식입니다. JPG, PNG, WebP 이미지를 선택해주세요.",
    };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `파일 크기가 너무 큽니다 (최대 ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB).`,
    };
  }
  return { valid: true };
}

/**
 * Resizes and compresses an image File in browser environment to an optimized WebP data URL.
 * Preserves alpha transparency for PNGs when WebP is supported.
 *
 * @param {File} file - The image file from file input or drag-and-drop
 * @param {Object} options - { maxWidth: 1000, maxHeight: 1000, quality: 0.85 }
 * @returns {Promise<{ dataUrl: string, fileName: string, width: number, height: number, sizeKb: number }>}
 */
export function compressImageFile(file, options = {}) {
  const { maxWidth = 1000, maxHeight = 1000, quality = 0.85 } = options;

  return new Promise((resolve, reject) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      return reject(new Error(validation.error));
    }

    if (typeof window === "undefined" || typeof document === "undefined") {
      return reject(new Error("브라우저 환경에서만 이미지 압축이 가능합니다."));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다. 다시 시도해주세요."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("유효한 이미지 형식이 아닙니다."));
      img.onload = () => {
        let width = img.width || 1;
        let height = img.height || 1;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return reject(new Error("Canvas 생성에 실패했습니다."));
        }

        let dataUrl = "";
        try {
          ctx.drawImage(img, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/webp", quality);
        } catch (err) {
          return reject(new Error(`이미지 렌더링 오류: ${err.message}`));
        }

        // Fallback for browsers lacking WebP canvas export
        if (!dataUrl || !dataUrl.startsWith("data:image/webp")) {
          // Fill background white for JPEG to avoid black transparent areas
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        const base64Len = dataUrl.length - (dataUrl.indexOf(",") + 1);
        const sizeBytes = Math.round((base64Len * 3) / 4);
        const sizeKb = Number((sizeBytes / 1024).toFixed(1));

        resolve({
          dataUrl,
          fileName: file.name,
          width,
          height,
          sizeKb,
        });
      };
      img.src = e.target?.result;
    };
    reader.readAsDataURL(file);
  });
}
