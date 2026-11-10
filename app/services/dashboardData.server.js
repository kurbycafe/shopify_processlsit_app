export async function getDashboardData({ admin, shop, db, getUpcomingContainers, getTodayRange, getThisWeekRange, getPastDaysRange, getCalendarMonths }) {
  // 1. Unfulfilled orders count
  const ordersTask = (async () => {
  try {
    const unfulfilledQuery = `#graphql
      query getUnfulfilledCount {
        ordersCount(query: "fulfillment_status:unfulfilled") {
          count
        }
      }
    `;
    const response = await admin.graphql(unfulfilledQuery);
    const json = await response.json();
    return json.data?.ordersCount?.count || 0;
  } catch (err) {
    console.error("Failed to fetch unfulfilled orders count:", err.message);
    return 0;
  }
  })();
  const containersTask = getUpcomingContainers();

  // 2. Timezone-aware date calculations (Europe/Berlin default)
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const { start: startOfWeek, end: endOfWeek } = getThisWeekRange();

  // 3. Today printed delivery notes
  const todayPrintedCountTask = db.inspectionRecord.count({
    where: {
      shop,
      isLieferscheinPrinted: true,
      updatedAt: {
        gte: todayStart,
        lte: todayEnd,
      },
    },
  });

  // 4. This week fulfilled & inspected count
  const thisWeekFulfilledCountTask = db.inspectionRecord.count({
    where: {
      shop,
      status: "SUCCESS",
      OR: [
        { completedAt: { gte: startOfWeek, lte: endOfWeek } },
        { updatedAt: { gte: startOfWeek, lte: endOfWeek } },
        { createdAt: { gte: startOfWeek, lte: endOfWeek } },
      ],
    },
  });

  // 5. Back in stock pending requests count
  const pendingBackInStockCountTask = db.backInStockSubscription.count({
    where: {
      shop,
      status: "PENDING",
    },
  });

  // 5.5. Pending customer inquiries & return requests
  const pendingCustomerInquiryCountTask = typeof db.customerRequest?.count === "function"
    ? db.customerRequest.count({
        where: {
          shop,
          type: { in: ["SUPPORT", "CLAIM", "RETURN"] },
          status: "REQUESTED",
        },
      }).catch(() => 0)
    : Promise.resolve(0);

  // 5.6. Failed push notification deliveries
  const failedPushCountTask = typeof db.customerRequest?.count === "function"
    ? db.customerRequest.count({
        where: {
          shop,
          type: { in: ["PUSH_DELIVERY", "PUSH_GUEST_DELIVERY"] },
          status: { in: ["FAILED", "UNKNOWN"] },
        },
      }).catch(() => 0)
    : Promise.resolve(0);

  // 6. Recent QC & Inspection logs
  // InspectionRecord also holds rows created by printing, invoices and alerts (status PENDING, never inspected);
  // only rows a completed inspection wrote carry completedAt.
  const recentLogsTask = db.inspectionRecord.findMany({
    where: { shop, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 6,
    include: {
      items: true,
    },
  });

  // 7. Optimized single query for 7-day productivity metrics (N+1 eliminated)
  // Only actual completed or reported inspections belong in productivity metrics;
  // uninspected PENDING rows (created by order syncing, printing, or invoice alerts) are excluded.
  const chartDays = getPastDaysRange(7);
  const chartRangeStart = chartDays[0].start;
  const chartRangeEnd = chartDays[chartDays.length - 1].end;

  const past7DayRecordsTask = db.inspectionRecord.findMany({
    where: {
      shop,
      status: { not: "PENDING" },
      OR: [
        { completedAt: { gte: chartRangeStart, lte: chartRangeEnd } },
        { updatedAt: { gte: chartRangeStart, lte: chartRangeEnd } },
        { createdAt: { gte: chartRangeStart, lte: chartRangeEnd } },
      ],
    },
    select: {
      status: true,
      completedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  const [
    unfulfilledCount,
    upcomingContainers,
    todayPrintedCount,
    thisWeekFulfilledCount,
    pendingBackInStockCount,
    pendingCustomerInquiryCount,
    failedPushCount,
    recentLogs,
    past7DayRecords,
  ] = await Promise.all([
    ordersTask,
    containersTask,
    todayPrintedCountTask,
    thisWeekFulfilledCountTask,
    pendingBackInStockCountTask,
    pendingCustomerInquiryCountTask,
    failedPushCountTask,
    recentLogsTask,
    past7DayRecordsTask,
  ]);

  const chartData = chartDays.map((dayObj) => {
    const dayRecords = past7DayRecords.filter((r) => {
      if (r.status === "PENDING") return false;
      const recordDate = r.completedAt || r.updatedAt || r.createdAt;
      return recordDate >= dayObj.start && recordDate <= dayObj.end;
    });

    const successCount = dayRecords.filter((r) => r.status === "SUCCESS").length;
    const partialCount = dayRecords.filter((r) => r.status === "PARTIAL").length;
    const issueCount = dayRecords.filter(
      (r) => r.status === "ISSUE_REPORTED" || r.status === "FAILED"
    ).length;
    const totalCount = successCount + partialCount + issueCount;

    return {
      dateLabel: dayObj.dateLabel,
      totalCount,
      successCount,
      partialCount,
      issueCount,
    };
  });

  // 8. Odoo incoming container schedule & calendar
  const calendarMonths = getCalendarMonths();

  return {
    unfulfilledCount,
    todayPrintedCount,
    thisWeekFulfilledCount,
    pendingBackInStockCount,
    pendingCustomerInquiryCount: pendingCustomerInquiryCount || 0,
    failedPushCount: failedPushCount || 0,
    recentLogs,
    upcomingContainers,
    calendarMonths,
    chartData,
  };
}
