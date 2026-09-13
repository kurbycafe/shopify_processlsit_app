const VALID_STATUSES = new Set(['ARRIVED', 'RECEIVED']);
export async function changeContainerStatus({ db, shop, containerRef, status, notify, now = new Date() }) {
  if (!containerRef || !VALID_STATUSES.has(status)) return { error: '유효한 컨테이너와 입고 상태를 선택해 주세요.' };
  const result = await db.$transaction(async tx => {
    const key = `${shop}:${containerRef}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const container = await tx.container.findUnique({ where: { shop_containerRef: { shop, containerRef } }, include: { items: true } });
    if (!container) return { error: '컨테이너를 먼저 조회하여 저장해 주세요.' };
    if (container.status === status) return { container, changed: false };
    if (container.status === 'RECEIVED') return { error: '입고 완료된 컨테이너는 이전 상태로 변경할 수 없습니다.' };
    const updated = await tx.container.update({ where: { id: container.id }, data: { status, ...(status === 'RECEIVED' ? { receivedAt: now } : {}) } });
    return { container: { ...updated, items: container.items }, changed: true };
  });
  if (result.error) return result;
  let warning = '';
  if (result.changed && status === 'RECEIVED' && result.container.items.length) {
    try { await notify({ shop, containerRef, receivedAt: result.container.receivedAt, items: result.container.items }); }
    catch { warning = '입고 상태는 저장되었지만 알림 처리가 실패했습니다. 알림 관리에서 발송 내역을 확인해 주세요.'; }
  }
  return { success: true, containerRef, status: result.container.status, receivedAt: result.container.receivedAt,
    message: result.changed ? `컨테이너 [${containerRef}] 상태가 [${status}]로 저장되었습니다.` : '이미 해당 상태로 저장되어 있습니다.', warning };
}
