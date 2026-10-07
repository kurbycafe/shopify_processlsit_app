import dayjs from "dayjs";

export function getCalendarMonths() {
  const now = dayjs();
  const nextMonth = now.add(1, "month");
  const months = [now, nextMonth];

  return months.map((monthDoc) => {
    const year = monthDoc.year();
    const month = monthDoc.month();
    const monthLabel = `${month + 1}월`;
    const yearLabel = `${year}년`;
    const daysInMonth = monthDoc.daysInMonth();
    const startDayOfWeek = monthDoc.startOf("month").day();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const currentDay = monthDoc.date(d);
      days.push({
        dateNumber: d,
        formattedDate: currentDay.format("YYYY-MM-DD"),
      });
    }

    return {
      year,
      month: month + 1,
      monthLabel,
      yearLabel,
      days,
    };
  });
}
