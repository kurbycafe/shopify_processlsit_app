import { useState, useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  TextField,
  Banner,
  Box,
} from "@shopify/polaris";

export function AppFeatureRequestCard({
  actionUrl,
  showViewListButton = true,
  onSuccess,
}) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const lastHandledRef = useRef(null);

  const [kind, setKind] = useState("FEATURE");
  const [content, setContent] = useState("");
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (lastHandledRef.current === fetcher.data) return;
    lastHandledRef.current = fetcher.data;

    if (fetcher.data.ok) {
      setBanner({
        tone: "success",
        message: fetcher.data.message || "요청이 접수되었습니다",
      });
      setContent("");
      if (typeof onSuccess === "function") {
        onSuccess(fetcher.data.item);
      }
    } else if (fetcher.data.error) {
      setBanner({
        tone: "critical",
        message: fetcher.data.error,
      });
    }
  }, [fetcher.state, fetcher.data, onSuccess]);

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!trimmed || fetcher.state !== "idle") return;
    setBanner(null);
    const submitOpts = { method: "POST" };
    if (actionUrl) submitOpts.action = actionUrl;
    fetcher.submit(
      {
        intent: "create_app_feature_request",
        kind,
        content: trimmed,
      },
      submitOpts
    );
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap gap="200">
          <Text variant="headingMd" as="h2">
            모바일 앱 기능 추가/수정 요청
          </Text>
          {showViewListButton && (
            <Button variant="plain" onClick={() => navigate("/app/app-requests")}>
              앱 개선 요청 내역 보기
            </Button>
          )}
        </InlineStack>

        {banner && (
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            <Text as="p">{banner.message}</Text>
          </Banner>
        )}

        <Box maxWidth="240px">
          <Select
            label="구분"
            labelInline
            options={[
              { label: "기능 추가", value: "FEATURE" },
              { label: "기능 수정", value: "CHANGE" },
              { label: "오류", value: "BUG" },
            ]}
            value={kind}
            onChange={setKind}
          />
        </Box>

        <TextField
          label="요청 내용"
          labelHidden
          placeholder="요청 내용을 적어주세요 (최대 2,000자)"
          value={content}
          onChange={setContent}
          multiline={3}
          maxLength={2000}
          showCharacterCount
          autoComplete="off"
        />

        <InlineStack align="end">
          <Button
            variant="primary"
            disabled={!content.trim() || fetcher.state !== "idle"}
            loading={fetcher.state !== "idle"}
            onClick={handleSubmit}
          >
            요청하기
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default AppFeatureRequestCard;

