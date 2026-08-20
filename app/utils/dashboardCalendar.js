import dayjs from "dayjs";

/**
 * 대시보드 입고 일정용 달력 데이터 생성 (이번 달 & 다음 달)
 * 클라이언트 직렬화(JSON) 시 함수 소실 방지를 위해 순수 JSON 객체 형태로 날짜 반환
 */
export function getCalendarMonths() {
  const now = dayjs();
  const nextMonth = now.add(1, "month");
  const months = [now, nextMonth];

  return months.map((monthDoc) => {
    const year = monthDoc.year();
    const month = monthDoc.month(); // 0 = Jan, 11 = Dec
    const monthLabel = `${month + 1}월`;
    const yearLabel = `${year}년`;
    const daysInMonth = monthDoc.daysInMonth();
    const startDayOfWeek = monthDoc.startOf("month").day(); // 0 = Sun, 6 = Sat

    const days = [];
    // 공백 채우기 (이전 달 날짜 영역)
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    // 이번 달 날짜 채우기 (순수 직렬화 가능 객체)
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
