// Общие правила для SQLite API и версии на статическом хостинге.
export const REMINDER_OPTIONS = [5, 15, 30, 60, 120, 1440];
export const CATEGORIES = [
  { name: 'Личное', color: '#ad747e', emoji: '', aliases: ['личное', 'личные'] },
  { name: 'Работа', color: '#6985a5', emoji: '', aliases: ['работа', 'работе', 'рабоч'] },
  { name: 'Семья', color: '#739480', emoji: '', aliases: ['семья', 'семьи', 'семье'] },
  { name: 'Здоровье', color: '#ae975f', emoji: '', aliases: ['здоровье', 'здоровья'] },
  { name: 'Обучение', color: '#9383ad', emoji: '', aliases: ['обучение', 'учёба', 'учеба'] },
  { name: 'Другое', color: '#929691', emoji: '', aliases: [] },
];

export function dateKey(value, tz = 'Europe/Moscow') {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(key, n) {
  const date = new Date(key + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
export function localInput(value, tz = 'Europe/Moscow') {
  if (!dateKey(value, tz)) return '';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return `${dateKey(value, tz)}T${time}`;
}
export function localToIso(value, tz = 'Europe/Moscow') {
  if (!value) return null;
  const target = Date.parse(value + ':00Z');
  if (!Number.isFinite(target)) throw new Error('Укажите корректную дату и время');
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(localInput(guess, tz) + ':00Z');
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}
export function normalizeReminders(values = [60]) {
  if (!Array.isArray(values)) throw new Error('Некорректное напоминание');
  const minutes = [...new Set(values.map(Number))];
  if (minutes.some(v => !Number.isSafeInteger(v) || v <= 0 || v > 10080)) throw new Error('Некорректное напоминание');
  return minutes;
}
export function normalizeTask(payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Добавьте название задачи');
  if (!payload.start_at || !Number.isFinite(Date.parse(payload.start_at))) throw new Error('Укажите дату и время');
  return { ...payload, title, start_at: new Date(payload.start_at).toISOString(),
    timezone: payload.timezone || 'Europe/Moscow',
    category: CATEGORIES.some(c => c.name === payload.category) ? payload.category : 'Другое',
    priority: Math.max(1, Math.min(5, Number(payload.priority) || 3)),
    reminders: normalizeReminders(payload.reminders),
  };
}
export function filteredTasks(tasks, filter = 'all', query = '', tz = 'Europe/Moscow', now = Date.now()) {
  const today = dateKey(now, tz);
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const startWeek = addDays(today, -dow);
  const q = query.trim().toLocaleLowerCase('ru');
  return tasks.filter(t => {
    const day = dateKey(t.start_at, tz);
    if (q && ![t.title, t.description, t.location, t.category].some(v => String(v || '').toLocaleLowerCase('ru').includes(q))) return false;
    if (filter === 'today') return day === today && t.status !== 'cancelled';
    if (filter === 'tomorrow') return day === addDays(today, 1) && t.status !== 'cancelled';
    if (filter === 'week') return day >= startWeek && day < addDays(startWeek, 7) && t.status !== 'cancelled';
    if (filter === 'done') return t.status === 'done';
    if (filter === 'postponed') return t.postponed_count > 0 && t.status !== 'done';
    if (filter === 'undated') return !day;
    return true;
  }).sort((a, b) => (Date.parse(a.start_at) || 0) - (Date.parse(b.start_at) || 0));
}
export function homeBuckets(tasks, tz, now = Date.now()) {
  const today = dateKey(now, tz);
  const out = { overdue: [], now_tasks: [], soon_tasks: [], later_today: [], done_today: [] };
  for (const task of filteredTasks(tasks)) {
    const day = dateKey(task.start_at, tz);
    if (!day || task.status === 'cancelled') continue;
    if (task.status === 'done') { if (day === today) out.done_today.push(task); continue; }
    const diff = (Date.parse(task.start_at) - now) / 60000;
    if (diff < -30) out.overdue.push(task);
    else if (day === today) {
      if (diff <= 30) out.now_tasks.push(task);
      else if (diff <= 120) out.soon_tasks.push(task);
      else out.later_today.push(task);
    }
  }
  return out;
}
export function calendarDays(tasks, anchor, mode, tz, now = Date.now()) {
  let key = dateKey(anchor, tz);
  const month = key.slice(0, 7);
  if (mode === 'month') key = month + '-01';
  const dow = (new Date(key + 'T12:00:00Z').getUTCDay() + 6) % 7;
  if (mode !== 'day') key = addDays(key, -dow);
  const count = mode === 'month' ? 42 : mode === 'week' ? 7 : 1;
  const sorted = filteredTasks(tasks);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(key, i);
    return { date, in_current_month: date.startsWith(month), is_today: date === dateKey(now, tz),
      tasks: sorted.filter(t => dateKey(t.start_at, tz) === date && t.status !== 'cancelled') };
  });
}
export function postponedStart(task, opts, tz = task.timezone || 'Europe/Moscow', now = Date.now()) {
  if (opts.mode === 'date') return new Date(opts.new_start).toISOString();
  if (opts.mode === 'hour') return new Date(Date.parse(task.start_at) + Number(opts.hours) * 3600000).toISOString();
  let day = dateKey(Math.max(Date.parse(task.start_at), now), tz);
  let time = '10:00';
  if (opts.mode === 'tomorrow') day = addDays(day, 1);
  if (opts.mode === 'evening') { time = '19:00'; if (localToIso(`${day}T${time}`, tz) <= new Date(now).toISOString()) day = addDays(day, 1); }
  if (opts.mode === 'weekend') { const dow = new Date(day + 'T12:00:00Z').getUTCDay(); day = addDays(day, (6 - dow + 7) % 7 || 7); time = '11:00'; }
  return localToIso(`${day}T${time}`, tz);
}

// Разбор быстрого ввода одинаков в серверном и локальном режимах.
export function parseNatural(text, tz = 'Europe/Moscow', now = Date.now(), defaultReminders = [60]) {
  if (!text?.trim()) return null;
  let title = text.trim();
  let day = dateKey(now, tz), time = '10:00';
  const take = (re, action) => { title = title.replace(re, (...args) => { action(...args); return ' '; }); };
  take(/(^|\s)(послезавтра|завтра|сегодня)(?=\s|[,.;]|$)/iu, (_, space, word) => { day = addDays(day, word === 'послезавтра' ? 2 : word === 'завтра' ? 1 : 0); });
  take(/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?=\s|[,;]|$)/u, (_, d, m, y) => { day = `${y || day.slice(0, 4)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; });
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  take(new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${months.join('|')})(?=\\s|[,;]|$)`, 'iu'), (_, d, m) => { day = `${day.slice(0, 4)}-${String(months.indexOf(m.toLowerCase()) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`; });
  const weekdays = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
  take(new RegExp(`(?:^|\\s)(?:в\\s+)?(${weekdays.join('|')})(?=\\s|[,;]|$)`, 'iu'), (_, word) => { const current = new Date(day + 'T12:00:00Z').getUTCDay(); day = addDays(day, (weekdays.indexOf(word.toLowerCase()) - current + 7) % 7 || 7); });
  take(/(?:^|\s)(?:в\s+)?(\d{1,2})[:.](\d{2})(?=\s|[,;]|$)/u, (_, h, m) => { time = `${h.padStart(2, '0')}:${m}`; });
  take(/(?:^|\s)в\s+(\d{1,2})(?:\s+(утра|дня|вечера|ночи))?(?=\s|[,;]|$)/iu, (_, h, part) => { let hour = Number(h); if (['дня','вечера'].includes(part?.toLowerCase()) && hour < 12) hour += 12; if (['утра','ночи'].includes(part?.toLowerCase()) && hour === 12) hour = 0; time = `${String(hour).padStart(2, '0')}:00`; });
  let reminders;
  take(/(?:[,;]?\s*)(?:напомни(?:ть)?\s+)?за\s+(\d+|полчаса|час|день)\s*(минут(?:у|ы)?|мин|час(?:а|ов)?|дн(?:я|ей)|день)?(?=\s|[,.;]|$)/giu, (_, n, unit) => {
    const value = n.toLowerCase() === 'час' ? 60 : n.toLowerCase() === 'полчаса' ? 30 : n.toLowerCase() === 'день' ? 1440 : Number(n) * (/^час/iu.test(unit) ? 60 : /^(дн|день)/iu.test(unit) ? 1440 : 1);
    if (!REMINDER_OPTIONS.includes(value)) throw new Error('Выберите напоминание: 5, 15, 30 минут, 1 или 2 часа, 1 день');
    (reminders ||= []).push(value);
  });
  take(/(?:[,;]?\s*)без\s+напоминани[йя]/iu, () => { reminders = []; });
  let recurrence_rule = null;
  take(/каждый день|ежедневно|каждую неделю|еженедельно|каждый месяц|ежемесячно|по будням/iu, match => { recurrence_rule = /день|ежедневно/iu.test(match) ? 'daily' : /месяц|ежемесячно/iu.test(match) ? 'monthly' : /будням/iu.test(match) ? 'weekdays' : 'weekly'; });
  const category = CATEGORIES.find(c => c.aliases.some(a => title.toLowerCase().includes(a)))?.name || 'Другое';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || dateKey(day + 'T12:00:00Z', 'UTC') !== day) throw new Error('Проверьте дату и время');
  return normalizeTask({ title: title.replace(/^[\s,.;—-]+|[\s,.;—-]+$/g, '').replace(/\s+/g, ' ') || text.trim(), start_at: localToIso(`${day}T${time}`, tz), timezone: tz, category, reminders: reminders ?? defaultReminders, recurrence_rule });
}
