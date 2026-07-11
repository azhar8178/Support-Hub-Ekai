/**
 * Business-hours time engine.
 * Business hours: 09:00-18:00 UTC, Monday-Friday.
 */

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;
const MS_PER_MINUTE = 60_000;
const BUSINESS_MINUTES_PER_DAY = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Advance to the next moment that is inside business hours (no-op if already inside). */
export function nextBusinessMoment(from: Date): Date {
  const d = new Date(from.getTime());
  for (;;) {
    if (isWeekend(d)) {
      // Move to next day 09:00
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      continue;
    }
    const hour = d.getUTCHours();
    if (hour < BUSINESS_START_HOUR) {
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      continue;
    }
    if (hour >= BUSINESS_END_HOUR) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      continue;
    }
    return d;
  }
}

/** Add N business minutes to a date (skipping nights and weekends). */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let remaining = minutes;
  let cursor = nextBusinessMoment(from);
  while (remaining > 0) {
    const endOfDay = new Date(cursor.getTime());
    endOfDay.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0);
    const availableMinutes = (endOfDay.getTime() - cursor.getTime()) / MS_PER_MINUTE;
    if (remaining <= availableMinutes) {
      return new Date(cursor.getTime() + remaining * MS_PER_MINUTE);
    }
    remaining -= availableMinutes;
    cursor = nextBusinessMoment(endOfDay);
  }
  return cursor;
}

/** Business minutes elapsed between two dates. */
export function businessMinutesBetween(a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  let cursor = nextBusinessMoment(a);
  // Iterate day by day; bounded to avoid pathological loops.
  for (let i = 0; i < 3660 && cursor < b; i++) {
    const endOfDay = new Date(cursor.getTime());
    endOfDay.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0);
    const sliceEnd = b < endOfDay ? b : endOfDay;
    if (sliceEnd > cursor) {
      total += (sliceEnd.getTime() - cursor.getTime()) / MS_PER_MINUTE;
    }
    cursor = nextBusinessMoment(endOfDay);
  }
  return total;
}

/** Add N whole business days (weekdays), preserving time-of-day. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

export { BUSINESS_MINUTES_PER_DAY };
