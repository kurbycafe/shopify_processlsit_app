import { useState, useRef } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Badge,
  Banner,
  Spinner,
} from "@shopify/polaris";
import { compressImageFile } from "../utils/imageCompressor.js";

/**
 * BannerImageUploader provides:
 * 1. Direct local file upload with drag-and-drop & instant client-side WebP compression.
 * 2. Real-time visual banner preview matching the mobile app hero banner layout.
 * 3. Fallback / manual URL input for Shopify CDN or external links.
 */
export default function BannerImageUploader({
  imageUrl = "",
  onChange,
  bgGradient = "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
  titleKo = "",
  tagKo = "주간 특가",
  ctaKo = "특가 보기",
}) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fileMeta, setFileMeta] = useState(null);
  const [showUrlField, setShowUrlField] = useState(false);

  const isBase64 = Boolean(
    imageUrl && (imageUrl.startsWith("data:image/") || imageUrl.startsWith("blob:"))
  );
  const isCdn = Boolean(imageUrl && imageUrl.startsWith("http"));

  const handleProcessFile = async (file) => {
    if (!file) return;
    setErrorMessage("");
    setIsProcessing(true);
    try {
      const result = await compressImageFile(file, {
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 0.85,
      });
      setFileMeta({
        name: result.fileName,
        sizeKb: result.sizeKb,
        width: result.width,
        height: result.height,
      });
      onChange(result.dataUrl);
    } catch (err) {
      setErrorMessage(err.message || "이미지 압축 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleProcessFile(files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    const files = e.target?.files;
    if (files && files.length > 0) {
      handleProcessFile(files[0]);
    }
    // reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClearImage = () => {
    onChange("");
    setFileMeta(null);
    setErrorMessage("");
  };

  return (
    <BlockStack gap="300">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="headingSm" as="h3">
          배너 상품 이미지
        </Text>
        <Button
          variant="plain"
          size="slim"
          onClick={() => setShowUrlField(!showUrlField)}
        >
          {showUrlField ? "▲ URL 입력창 숨기기" : "▼ 이미지 URL 직접 입력 / 변경"}
        </Button>
      </div>

      {errorMessage && (
        <Banner tone="critical" onDismiss={() => setErrorMessage("")}>
          {errorMessage}
        </Banner>
      )}

      {/* Main Upload Box / Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: isDragging ? "2px dashed #008060" : "2px dashed #CBD5E1",
          borderRadius: "12px",
          padding: "20px 16px",
          background: isDragging ? "#F0FDF4" : "#F8FAFC",
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.2s ease-in-out",
        }}
      >
        {isProcessing ? (
          <BlockStack gap="200" inlineAlign="center">
            <Spinner size="small" />
            <Text variant="bodyMd" tone="subdued">
              이미지 변환 중…
            </Text>
          </BlockStack>
        ) : (
          <BlockStack gap="100" inlineAlign="center">
            <Text variant="bodyMd" fontWeight="semibold">
              이미지 선택 또는 끌어다 놓기
            </Text>
            <Text variant="bodySm" tone="subdued">
              PNG, JPG, WebP · 업로드 시 WebP로 변환
            </Text>
          </BlockStack>
        )}
      </div>

      {/* Upload info badge */}
      {fileMeta && imageUrl && (
        <InlineStack gap="200" align="center">
          <Badge tone="success">
            {`✓ ${fileMeta.name} (${fileMeta.sizeKb} KB - 자동 압축 완료)`}
          </Badge>
          <Text variant="bodyXs" tone="subdued">
            해상도: {fileMeta.width} × {fileMeta.height} px
          </Text>
        </InlineStack>
      )}

      {/* Live Preview Card */}
      {imageUrl && (
        <div
          style={{
            border: "1px solid #E2E8F0",
            borderRadius: "12px",
            padding: "14px",
            background: "#FFFFFF",
          }}
        >
          <BlockStack gap="300">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <InlineStack gap="200" align="center">
                <Text variant="bodySm" fontWeight="semibold">
                  모바일 앱 실시간 렌더링 미리보기
                </Text>
                <Badge tone={isBase64 ? "attention" : "info"}>
                  {isBase64 ? "PC 직접 업로드 (WebP)" : isCdn ? "외부 CDN 링크" : "이미지"}
                </Badge>
              </InlineStack>

              <InlineStack gap="200">
                <Button
                  size="slim"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  다른 이미지 선택
                </Button>
                <Button
                  size="slim"
                  tone="critical"
                  variant="plain"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearImage();
                  }}
                >
                  삭제
                </Button>
              </InlineStack>
            </div>

            {/* Mobile Hero Banner Mockup */}
            <div
              style={{
                position: "relative",
                borderRadius: "12px",
                background: bgGradient,
                padding: "16px 20px",
                minHeight: "120px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                color: "#FFFFFF",
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
            >
              {/* Left Text Preview */}
              <div style={{ maxWidth: "65%", zIndex: 1 }}>
                {tagKo && (
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: "11px",
                      fontWeight: 700,
                      background: "rgba(255,255,255,0.25)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      marginBottom: "6px",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {tagKo}
                  </span>
                )}
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    lineHeight: "1.3",
                    marginBottom: "8px",
                    wordBreak: "keep-all",
                  }}
                >
                  {titleKo || "배너 메인 헤드라인"}
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    opacity: 0.9,
                  }}
                >
                  {ctaKo || "특가 보기"} &rarr;
                </div>
              </div>

              {/* Right Studio Product Cutout Box */}
              <div
                style={{
                  position: "absolute",
                  right: "14px",
                  bottom: "12px",
                  width: "90px",
                  height: "90px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.95)",
                  padding: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}
              >
                <img
                  src={imageUrl}
                  alt="배너 미리보기"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    mixBlendMode: "multiply",
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            </div>
          </BlockStack>
        </div>
      )}

      {/* Manual URL Input (expandable) */}
      {showUrlField && (
        <TextField
          label="배너 이미지 URL (직접 입력 또는 Shopify CDN 링크)"
          value={imageUrl}
          onChange={(v) => {
            setFileMeta(null);
            onChange(v);
          }}
          helpText="내 컴퓨터에서 파일을 선택하면 위 주소가 자동 생성되며, 기존 Shopify CDN 주소를 붙여넣으셔도 정상 작동합니다."
          autoComplete="off"
        />
      )}
    </BlockStack>
  );
}
