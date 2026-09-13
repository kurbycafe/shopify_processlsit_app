export function shouldRevalidate({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) {
  if (formMethod && formMethod.toUpperCase() !== 'GET') return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const current = new URL(currentUrl); const next = new URL(nextUrl);
  const changed = current.searchParams.get('tempFilter') !== next.searchParams.get('tempFilter');
  current.searchParams.delete('tempFilter'); next.searchParams.delete('tempFilter');
  if (changed && current.href === next.href) return false;
  return defaultShouldRevalidate;
}
