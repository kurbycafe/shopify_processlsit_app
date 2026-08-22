import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export const DEFAULT_TIMEZONE = "Europe/Berlin";

/**
 * Returns current dayjs instance pinned to the target timezone (Europe/Berlin default)
 */
export function getLocalNow(tz = DEFAULT_TIMEZONE) {
  return dayjs().tz(tz);
}

/**
 * Returns start and end Date objects for today in the target timezone
 */
export function getTodayRange(tz = DEFAULT_TIMEZONE) {
  const localNow = getLocalNow(tz);
  return {
    start: localNow.startOf("day").toDate(),
    end: localNow.endOf("day").toDate(),
    dateStr: localNow.format("YYYY-MM-DD"),
  };
}

/**
 * Returns Monday 00:00:00 to Sunday 23:59:59 range for the current week
 */
export function getThisWeekRange(tz = DEFAULT_TIMEZONE) {
  const localNow = getLocalNow(tz);
  const dayOfWeek = localNow.day(); // 0(Sun), 1(Mon), ..., 6(Sat)
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = localNow.subtract(daysFromMonday, "day").startOf("day");
  const endOfWeek = startOfWeek.add(6, "day").endOf("day");

  return {
    start: startOfWeek.toDate(),
    end: endOfWeek.toDate(),
    startStr: startOfWeek.format("YYYY-MM-DD"),
    endStr: endOfWeek.format("YYYY-MM-DD"),
  };
}

/**
 * Generates an array of past N days with start/end Date bounds for charting
 */
export function getPastDaysRange(daysCount = 7, tz = DEFAULT_TIMEZONE) {
  const localNow = getLocalNow(tz);
  const days = [];

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = localNow.subtract(i, "day");
    days.push({
      dateStr: d.format("YYYY-MM-DD"),
      dateLabel: d.format("MM.DD (ddd)"),
      start: d.startOf("day").toDate(),
      end: d.endOf("day").toDate(),
    });
  }

  return days;
}

/**
 * Formats a given date to German local format: DD.MM.YYYY HH:mm
 */
export function formatLocalGermanDateTime(date, tz = DEFAULT_TIMEZONE) {
  if (!date) return "-";
  return dayjs(date).tz(tz).format("DD.MM.YYYY HH:mm");
}
