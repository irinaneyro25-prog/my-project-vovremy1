// tz.mjs — единая логика часовых поясов для всех слоёв.
// Все границы дня/недели/месяца считаются в TZ пользователя и
// возвращаются как UTC-ISO, в которых можно сравнивать start_at задач.
export function tzOffsetMinutes(tz, date = new Date()) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => Number(parts.find(p => p.type === t).value);
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'),
      hour, get('minute'), get('second'));
    return (asUtc - date.getTime()) / 60000;
  } catch { return 0; }
}
export function startOfDayInTz(date, tz) {
  const off = tzOffsetMinutes(tz, date);
  const local = new Date(date.getTime() - off * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + off * 60000);
}
export function endOfDayInTz(date, tz) {
  const s = startOfDayInTz(date, tz);
  return new Date(s.getTime() + 24 * 3600 * 1000 - 1);
}
export function startOfWeekInTz(date, tz) {
  const s = startOfDayInTz(date, tz);
  const dow = (s.getDay() + 6) % 7;
  return new Date(s.getTime() - dow * 24 * 3600 * 1000);
}
export function endOfWeekInTz(date, tz) {
  return new Date(startOfWeekInTz(date, tz).getTime() + 7 * 24 * 3600 * 1000 - 1);
}
export function startOfMonthInTz(year, month, tz) {
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const off = tzOffsetMinutes(tz, d);
  const local = new Date(d.getTime() - off * 60000);
  local.setUTCDate(1); local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + off * 60000);
}
export function endOfMonthInTz(year, month, tz) {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return new Date(startOfMonthInTz(next.y, next.m, tz).getTime() - 1);
}
export function addDaysInTz(date, n, tz) {
  const off = tzOffsetMinutes(tz, date);
  const local = new Date(date.getTime() - off * 60000);
  local.setUTCDate(local.getUTCDate() + n);
  return new Date(local.getTime() + off * 60000);
}
export function ymdInTz(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
