import { useEffect, useState } from "react";

/**
 * Parses JSON responses from `/app/product-*` endpoints with unified auth/error handling.
 */
export async function parseProductMetaJson(response) {
  if (response.status === 401 || response.status === 403) {
    throw new Error("로그인이 만료되었거나 권한이 없습니다. 앱을 다시 열어주세요.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("서버 응답을 읽지 못했습니다. 앱을 다시 열거나 새로고침해주세요.");
  }
  if (!response.ok || result.success !== true) {
    const error = new Error(result.message || "요청에 실패했습니다. 다시 시도해주세요.");
    error.details = result.details;
    error.status = response.status;
    throw error;
  }
  return result;
}

/**
 * Paginates through all cursor pages of a `/app/product-*` endpoint with abort/cycle protection.
 */
export function usePaginatedProductMeta({
  endpoint,
  validateItem,
  nextCursorErrorMessage = "상품의 다음 페이지를 불러오지 못했습니다. 다시 조회해주세요.",
  onReset,
}) {
  const [items, setItems] = useState([]);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const rows = new Map();
    setItems([]);
    setLoadStatus("loading");
    setLoadError("");
    setLoadedAt(null);
    onReset?.();

    void (async () => {
      let after = null;
      const cursors = new Set();
      try {
        do {
          const url = endpoint + (after ? "?after=" + encodeURIComponent(after) : "");
          const data = await parseProductMetaJson(
            await fetch(url, {
              signal: controller.signal,
              credentials: "same-origin",
              cache: "no-store",
              headers: { Accept: "application/json" },
            })
          );
          if (!Array.isArray(data.items) || typeof data.pageInfo?.hasNextPage !== "boolean") {
            throw new Error("상품 목록 응답이 올바르지 않습니다.");
          }
          for (const item of data.items) {
            validateItem?.(item);
            rows.set(item.id, item);
          }
          if (!current) return;
          setItems([...rows.values()]);
          if (!data.pageInfo.hasNextPage) break;
          const next = data.pageInfo.endCursor;
          if (!next || cursors.has(next)) {
            throw new Error(nextCursorErrorMessage);
          }
          cursors.add(next);
          after = next;
        } while (current);

        if (current) {
          setLoadStatus("ready");
          setLoadedAt(new Date().toLocaleTimeString("ko-KR"));
        }
      } catch (error) {
        if (current && error.name !== "AbortError") {
          setLoadStatus("error");
          setLoadError(error.message);
        }
      }
    })();

    return () => {
      current = false;
      controller.abort();
    };
    // `onReset` and `validateItem` are caller callbacks that may be recreated per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, nextCursorErrorMessage, reloadKey]);

  return {
    items,
    setItems,
    loadStatus,
    loadError,
    loadedAt,
    reload: () => setReloadKey((value) => value + 1),
  };
}
