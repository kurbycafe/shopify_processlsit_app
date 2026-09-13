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

  // 6. Recent QC & Inspection logs
  const recentLogsTask = db.inspectionRecord.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: {
      items: true,
    },
  });

  // 7. Optimized single query for 7-day productivity metrics (N+1 eliminated)
  const chartDays = getPastDaysRange(7);
  const chartRangeStart = chartDays[0].start;
  const chartRangeEnd = chartDays[chartDays.length - 1].end;

  const past7DayRecordsTask = db.inspectionRecord.findMany({
    where: {
      shop,
      createdAt: {
        gte: chartRangeStart,
        lte: chartRangeEnd,
      },
    },
    select: {
      status: true,
      createdAt: true,
    },
  });

  const [unfulfilledCount, upcomingContainers, todayPrintedCount, thisWeekFulfilledCount, pendingBackInStockCount, recentLogs, past7DayRecords] = await Promise.all([
    ordersTask, containersTask, todayPrintedCountTask, thisWeekFulfilledCountTask, pendingBackInStockCountTask, recentLogsTask, past7DayRecordsTask,
  ]);

  const chartData = chartDays.map((dayObj) => {
    const dayRecords = past7DayRecords.filter(
      (r) => r.createdAt >= dayObj.start && r.createdAt <= dayObj.end
    );

    return {
      dateLabel: dayObj.dateLabel,
      totalCount: dayRecords.length,
      successCount: dayRecords.filter((r) => r.status === "SUCCESS").length,
      partialCount: dayRecords.filter((r) => r.status === "PARTIAL").length,
      issueCount: dayRecords.filter(
        (r) => r.status === "ISSUE_REPORTED" || r.status === "FAILED"
      ).length,
    };
  });

  // 8. Odoo incoming container schedule & calendar
  const calendarMonths = getCalendarMonths();

  return {
    unfulfilledCount,
    todayPrintedCount,
    thisWeekFulfilledCount,
    pendingBackInStockCount,
    recentLogs,
    upcomingContainers,
    calendarMonths,
    chartData,
  };
}
