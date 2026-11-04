export const FEATURE_REQUEST_KINDS = ["FEATURE", "CHANGE", "BUG"];

export const FEATURE_REQUEST_KIND_LABELS = {
  FEATURE: "기능 추가",
  CHANGE: "기능 수정",
  BUG: "오류",
};

export const FEATURE_REQUEST_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "ON_HOLD",
];

export const FEATURE_REQUEST_STATUS_LABELS = {
  PENDING: "대기",
  IN_PROGRESS: "요청 확인됨",
  DONE: "완료",
  ON_HOLD: "보류",
};

export const TERMINAL_FEATURE_REQUEST_STATUSES = new Set(["DONE", "ON_HOLD"]);

export const MAX_FEATURE_REQUEST_CONTENT_LENGTH = 2000;
export const MAX_FEATURE_REQUEST_NOTE_LENGTH = 1000;
export const FEATURE_REQUEST_PAGE_SIZE = 50;
export const STATUS_MANAGER_EMAIL = "kgt@dawayo.de";
