// ── US equity market hours ─────────────────────────────────────────────────────
// Everything here is evaluated in America/New_York via Intl, never as a fixed UTC
// offset: the US observes DST and Thailand does not, so the Bangkok-time window
// shifts by an hour twice a year (20:30–03:00 in summer, 21:30–04:00 in winter).
// Hardcoding the offset would silently poll at the wrong hours for months.

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});

// New York wall clock for an instant: ISO date, weekday, and minutes since midnight.
export function nyClock(at: Date = new Date()): { date: string; weekday: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of NY.formatToParts(at)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

const OPEN = 9 * 60 + 30;   // 09:30 ET
const CLOSE = 16 * 60;      // 16:00 ET
const EARLY_CLOSE = 13 * 60; // 13:00 ET on half days

// NYSE full closures. A stale list only costs a few wasted polls on a holiday —
// it can never report a closed market as open at the wrong TIME of day — so the
// list failing to cover future years is a safe, self-limiting kind of wrong.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// Half days: the market closes at 13:00 ET (day after Thanksgiving, Christmas Eve).
const EARLY_CLOSES = new Set([
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

export type MarketState = { open: boolean; date: string; closesAt: number; minutes: number };

// Regular session only — pre/post market trades are not what the quote sources report.
export function marketState(at: Date = new Date()): MarketState {
  const { date, weekday, minutes } = nyClock(at);
  const closesAt = EARLY_CLOSES.has(date) ? EARLY_CLOSE : CLOSE;
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";
  const open = isWeekday && !HOLIDAYS.has(date) && minutes >= OPEN && minutes < closesAt;
  return { open, date, closesAt, minutes };
}

export const isMarketOpen = (at: Date = new Date()): boolean => marketState(at).open;
