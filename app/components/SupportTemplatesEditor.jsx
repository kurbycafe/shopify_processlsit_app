import { useEffect, useRef, useState } from "react";
import { Banner, BlockStack, Button, InlineStack, Modal, TextField } from "@shopify/polaris";

export default function SupportTemplatesEditor({ open, templates, fetcher, onClose, onSaved }) {
  const [draft, setDraft] = useState([]);
  const before = useRef(fetcher.state);
  useEffect(() => { if (open) setDraft(templates.map(item => ({ ...item }))); }, [open]);
  useEffect(() => {
    if (before.current !== "idle" && fetcher.state === "idle" && fetcher.data?.success) { onSaved(); onClose(); }
    before.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);
  const busy = fetcher.state !== "idle";
  const setField = (index, field, value) => setDraft(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const invalid = draft.some(item => !item.label.trim() || !item.value.trim());
  return <Modal open={open} onClose={onClose} title="답변 템플릿 편집" primaryAction={{ content: "저장", loading: busy, disabled: busy || invalid, onAction: () => fetcher.submit({ intent: "support_templates", templates: JSON.stringify(draft) }, { method: "post", action: "/app/customer-requests" }) }} secondaryActions={[{ content: "취소", onAction: onClose, disabled: busy }]}>
    <Modal.Section><BlockStack gap="400">
      {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
      {draft.map((item, index) => <div key={index} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}><BlockStack gap="200">
        <TextField label={`템플릿 ${index + 1} 제목`} value={item.label} maxLength={100} onChange={value => setField(index, "label", value)} autoComplete="off" />
        <TextField label="내용" value={item.value} multiline={3} maxLength={4000} onChange={value => setField(index, "value", value)} autoComplete="off" />
        <InlineStack align="end"><Button tone="critical" onClick={() => setDraft(current => current.filter((_, i) => i !== index))}>삭제</Button></InlineStack>
      </BlockStack></div>)}
      <Button disabled={draft.length >= 30} onClick={() => setDraft(current => [...current, { label: "", value: "" }])}>템플릿 추가</Button>
    </BlockStack></Modal.Section>
  </Modal>;
}
