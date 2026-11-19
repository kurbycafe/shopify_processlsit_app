import { useState, useRef, useEffect } from "react";

const EMPTY_REQUESTS = [];

const DEFAULT_REACT_HOOKS = { useState, useRef, useEffect };

/**
 * Shared cursor-paginated loader/reloader hook for customer & B2B request managers.
 */
export function useCursorRequests({
  fetcher,
  updateFetcher,
  buildLoadUrl,
  initialStatus = "ALL",
  onUpdateSuccess,
  hooks = DEFAULT_REACT_HOOKS,
}) {
  const [statusFilter, setStatusFilter] = hooks.useState(initialStatus);
  const [currentCursor, setCurrentCursor] = hooks.useState(null);
  const prevUpdateState = hooks.useRef(updateFetcher.state);
  const buildLoadUrlRef = hooks.useRef(buildLoadUrl);
  const onUpdateSuccessRef = hooks.useRef(onUpdateSuccess);
  buildLoadUrlRef.current = buildLoadUrl;
  onUpdateSuccessRef.current = onUpdateSuccess;

  const loadRequests = (status, cursor = null) => {
    fetcher.load(buildLoadUrlRef.current(status, cursor));
  };

  hooks.useEffect(() => {
    loadRequests(statusFilter, null);
    // Intentionally triggers whenever `statusFilter` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  hooks.useEffect(() => {
    if (
      prevUpdateState.current !== "idle" &&
      updateFetcher.state === "idle" &&
      updateFetcher.data?.success
    ) {
      onUpdateSuccessRef.current?.(updateFetcher.data);
      loadRequests(statusFilter, currentCursor);
    }
    prevUpdateState.current = updateFetcher.state;
    // Intentionally reacts only to updateFetcher transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateFetcher.state, updateFetcher.data, statusFilter, currentCursor]);

  const rawRequests = fetcher.data?.requests || EMPTY_REQUESTS;
  const nextCursor = fetcher.data?.nextCursor || null;

  return {
    statusFilter,
    currentCursor,
    rawRequests,
    nextCursor,
    isLoading: fetcher.state !== "idle",
    errorMessage: fetcher.data?.error || updateFetcher.data?.error || null,
    loadRequests,
    handleStatusChange: (newStatus) => {
      setStatusFilter(newStatus);
      setCurrentCursor(null);
    },
    handleNextPage: () => {
      if (!nextCursor) return;
      setCurrentCursor(nextCursor);
      loadRequests(statusFilter, nextCursor);
    },
    handleFirstPage: () => {
      setCurrentCursor(null);
      loadRequests(statusFilter, null);
    },
  };
}
