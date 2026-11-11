import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";
import ConfirmModal from "./ConfirmModal.jsx";

// One way to tell staff what happened and one way to ask before acting, shared
// by every admin screen instead of the browser's alert() and confirm() boxes.
const FALLBACK_NOTICE_MS = 5000;
const UNSAVED_TITLE = "저장하지 않은 변경 사항이 있습니다";
const UNSAVED_MESSAGE = "이 화면을 벗어나면 저장하지 않은 내용이 사라집니다. 이동하시겠습니까?";

const AppFeedbackContext = createContext(null);

export function AppFeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const resolverRef = useRef(null);

  const notify = useCallback((message, { isError = false } = {}) => {
    if (!message) return;
    // App Bridge shows the toast in the Shopify admin frame when the app is embedded.
    const toast = typeof window !== "undefined" ? window.shopify?.toast : null;
    if (toast?.show) toast.show(message, { isError });
    else setFallbackNotice({ message, isError });
  }, []);

  const settle = useCallback((answer) => {
    resolverRef.current?.(answer);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  /** Resolves true when staff confirm, false when they cancel or close the dialog. */
  const confirm = useCallback((options) => new Promise((resolve) => {
    // A second question replaces an unanswered one, which counts as cancelled.
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setDialog(typeof options === "string" ? { message: options } : options);
  }), []);

  useEffect(() => {
    if (!fallbackNotice) return undefined;
    const timer = setTimeout(() => setFallbackNotice(null), FALLBACK_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [fallbackNotice]);

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <AppFeedbackContext.Provider value={value}>
      {children}
      <ConfirmModal
        open={Boolean(dialog)}
        title={dialog?.title || "확인"}
        message={dialog?.message || ""}
        impactSummary={dialog?.impactSummary}
        confirmLabel={dialog?.confirmLabel}
        cancelLabel={dialog?.cancelLabel}
        destructive={Boolean(dialog?.destructive)}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
      {fallbackNotice && (
        <div
          role={fallbackNotice.isError ? "alert" : "status"}
          className={`app-fallback-notice${fallbackNotice.isError ? " app-fallback-notice--error" : ""}`}
        >
          {fallbackNotice.message}
        </div>
      )}
    </AppFeedbackContext.Provider>
  );
}

export function useAppFeedback() {
  const context = useContext(AppFeedbackContext);
  if (!context) throw new Error("useAppFeedback must be used inside AppFeedbackProvider");
  return context;
}

/**
 * Asks before leaving a screen that holds unsaved edits: in-app navigation gets
 * the shared confirm dialog, closing or reloading the tab gets the browser's own.
 */
export function useUnsavedChangesGuard(hasUnsavedChanges) {
  const { confirm } = useAppFeedback();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  ));

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let cancelled = false;
    confirm({ title: UNSAVED_TITLE, message: UNSAVED_MESSAGE, confirmLabel: "저장하지 않고 이동", cancelLabel: "계속 편집", destructive: true })
      .then((leave) => {
        if (cancelled) return;
        if (leave) blocker.proceed();
        else blocker.reset();
      });
    return () => { cancelled = true; };
  }, [blocker, confirm]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);
}

/**
 * Component form of the guard, for screens that only sometimes own the
 * navigation blocker (React Router allows one at a time).
 */
export function UnsavedChangesGuard({ when }) {
  useUnsavedChangesGuard(Boolean(when));
  return null;
}
