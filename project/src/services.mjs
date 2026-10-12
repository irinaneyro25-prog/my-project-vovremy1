// services.js — слой services, бизнес-логика
import { CATEGORIES } from './db.mjs';
import { TaskRepository, SettingsRepository, ProfileRepository } from './repositories.mjs';

const REMINDER_PROFILES = {
  soft:     { label: 'Мягкий',   values: [60] },
  standard: { label: 'Стандарт', values: [90, 60] },
  early:    { label: 'Ранний',   values: [120, 30] },
};

export { REMINDER_PROFILES };

// единый справочник категорий: имя, эмодзи, цвет, алиасы для NLP
export const CATEGORY_REGISTRY = [
  { name: 'Личное',   emoji: '🔴', color: '#e85a6a', aliases: ['личн','личное','личные'] },
  { name: 'Работа',   emoji: '🔵', color: '#3a78d6', aliases: ['рабоч','работ','работа','работе'] },
  { name: 'Семья',    emoji: '🟢', color: '#2fa866', aliases: ['семь','семья','семье','семьи'] },
  { name: 'Здоровье', emoji: '🟡', color: '#d4a72c', aliases: ['здоров','здоровье','здоровья'] },
  { name: 'Обучение', emoji: '🟣', color: '#8a5ad6', aliases: ['учеб','обучен','обучение','учёб','учеба'] },
];
const FALLBACK_CATEGORY = { name: 'Другое', emoji: '⚪', color: '#9aa0aa', aliases: [] };

function resolveCategory(name) {
  if (!name) return FALLBACK_CATEGORY;
  const hit = CATEGORY_REGISTRY.find(c => c.name === name);
  return hit || FALLBACK_CATEGORY;
}

// ---------- утилиты дат ----------
function toUtcIso(localDate, tz) {
  const tzOffsets = {
    'Europe/Moscow': 3, 'Europe/Kaliningrad': 2, 'Europe/Samara': 4,
    'Asia/Yekaterinburg': 5, 'Asia/Novosibirsk': 7, 'Asia/Krasnoyarsk': 7,
    'Asia/Irkutsk': 8, 'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10,
    'Asia/Magadan': 11, 'Asia/Kamchatka': 12,
  };
  const off = tzOffsets[tz] ?? 3;
  const [date, time] = localDate.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const utc = Date.UTC(y, mo - 1, d, h - off, mi);
  return new Date(utc).toISOString();
}

const WEEKDAYS = { 'понедельник': 1, 'вторник': 2, 'среда': 3, 'среду': 3, 'четверг': 4,
  'пятница': 5, 'суббота': 6, 'субботу': 6, 'воскресенье': 0 };
const MONTHS = { 'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
  'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12 };

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseNatural(text, tz = 'Europe/Moscow') {
  if (!text || !text.trim()) return null;
  const lower = (' ' + text.toLowerCase().trim() + ' ');
  const now = new Date();
  const stripped = [];

  let target = null;

  let m = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m) {
    const d = Number(m[1]); const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    target = new Date(y, mo - 1, d, 9, 0, 0);
    stripped.push(m[0]);
  }
  if (!target) {
    m = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i);
    if (m) {
      const d = Number(m[1]); const mo = MONTHS[m[2].toLowerCase()];
      let y = now.getFullYear();
      const cand = new Date(y, mo - 1, d, 9, 0, 0);
      target = cand < now ? new Date(y + 1, mo - 1, d, 9, 0, 0) : cand;
      stripped.push(m[0]);
    }
  }
  if (!target) {
    if (/\bсегодня\b/i.test(lower)) { target = new Date(now); target.setHours(9,0,0,0); stripped.push('сегодня'); }
    else if (/\bзавтра\b/i.test(lower)) { target = new Date(now); target.setDate(target.getDate()+1); target.setHours(10,0,0,0); stripped.push('завтра'); }
    else if (/\bпослезавтра\b/i.test(lower)) { target = new Date(now); target.setDate(target.getDate()+2); target.setHours(10,0,0,0); stripped.push('послезавтра'); }
  }
  if (!target) {
    for (const [name, idx] of Object.entries(WEEKDAYS)) {
      if (lower.includes(name)) {
        const cur = (now.getDay() + 6) % 7;
        const delta = ((idx - 1) - cur + 7) % 7 || 7;
        target = new Date(now);
        target.setDate(target.getDate() + delta);
        target.setHours(19,0,0,0);
        stripped.push(name);
        break;
      }
    }
  }
  if (!target) { target = new Date(now); target.setHours(9,0,0,0); }

  let hh = target.getHours(), mm = target.getMinutes();
  m = text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) {
    hh = Number(m[1]); mm = Number(m[2]); stripped.push(m[0]);
  } else {
    m = lower.match(/\bв\s+(\d{1,2})\s*(утра|дня|вечера|ночи)\b/);
    if (m) {
      hh = Number(m[1]);
      const mod = m[2];
      if (mod === 'утра' && hh === 12) hh = 0;
      if (mod === 'дня' && hh < 12) hh += 12;
      if (mod === 'вечера' && hh < 12) hh += 12;
      if (mod === 'ночи' && hh < 12) hh += 12;
      stripped.push(m[0]);
    } else {
      m = lower.match(/\bв\s+(\d{1,2})\b/);
      if (m && !stripped.some(s => /\d/.test(s))) {
        hh = Number(m[1]); mm = 0; stripped.push(m[0]);
      }
    }
  }
  target.setHours(hh, mm, 0, 0);

  const reminders = [];
  for (const rm of text.matchAll(/\bза\s+(\d+)\s*(минут|мин|час|часа|часов)\b/gi)) {
    const n = Number(rm[1]);
    const u = rm[2].toLowerCase();
    const mins = u.startsWith('час') ? n * 60 : n;
    reminders.push(mins);
  }
  if (!reminders.length) {
    if (/напомни\s+за\s+час/i.test(text)) reminders.push(60);
    if (/напомни\s+за\s+полчаса/i.test(text)) reminders.push(30);
  }
  const uniqReminders = [...new Set(reminders)].sort((a, b) => b - a);

  let category = FALLBACK_CATEGORY.name;
  let catHit = null;
  for (const c of CATEGORY_REGISTRY) {
    if (c.aliases.some(k => lower.includes(k))) { category = c.name; catHit = c.aliases[0]; break; }
  }
  if (catHit) stripped.push(catHit);

  let recurrence_rule = null;
  if (lower.includes('каждый день') || lower.includes('ежедневно')) recurrence_rule = 'daily';
  else if (lower.includes('каждую неделю') || lower.includes('еженедельно')) recurrence_rule = 'weekly';
  else if (lower.includes('каждый месяц') || lower.includes('ежемесячно')) recurrence_rule = 'monthly';
  else if (lower.includes('по будням') || lower.includes('будни')) recurrence_rule = 'weekdays';
  else {
    const wdMap = ['понедельникам','вторникам','средам','четвергам','пятницам','субботам','воскресеньям'];
    const ix = wdMap.findIndex(k => lower.includes(k));
    if (ix >= 0) recurrence_rule = `weekday:${ix}`;
  }

  let title = text;
  for (const f of stripped) {
    title = title.replace(new RegExp(escapeRe(f), 'i'), ' ');
  }
  title = title
    .replace(/[\s,.\-—:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = /^(в|во|на|с|со|к|ко|о|об|по|из|от|до|для|при|под|над|за|через|после|перед)$/i;
  for (let i = 0; i < 3; i++) {
    const w = title.split(/\s+/)[0];
    if (!w || !stop.test(w)) break;
    title = title.replace(/^\S+\s+/, '');
  }
  title = title.replace(/^[\s,.\-—:]+|[\s,.\-—:]+$/g, '').trim();
  if (!title) title = text.trim();

  const tzOffsets = {
    'Europe/Moscow': 3, 'Europe/Kaliningrad': 2, 'Europe/Samara': 4,
    'Asia/Yekaterinburg': 5, 'Asia/Novosibirsk': 7, 'Asia/Krasnoyarsk': 7,
    'Asia/Irkutsk': 8, 'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10,
    'Asia/Magadan': 11, 'Asia/Kamchatka': 12,
  };
  const off = tzOffsets[tz] ?? 3;
  const startUtc = new Date(target.getTime() - off * 3600 * 1000).toISOString();

  return {
    title,
    start_at: startUtc,
    timezone: tz,
    category,
    priority: 3,
    reminders: uniqReminders,
    recurrence_rule,
  };
}

// ---------- TaskService ----------
export class TaskService {
  constructor(taskRepo) { this.repo = taskRepo; this.userId = taskRepo.userId; }

  categories() {
    return [...CATEGORY_REGISTRY, FALLBACK_CATEGORY];
  }

  create(userId, payload, source = 'web') {
    const p = normalizeCreate(payload);
    return this.repo.add({ user_id: userId, ...p, source });
  }
  createFromText(userId, text, tz) {
    const p = parseNatural(text, tz);
    if (!p) throw new Error('не удалось разобрать текст');
    return this.repo.add({ user_id:userId, ...p });
  }
  previewFromText(text, tz) {
    return parseNatural(text, tz);
  }
  get(userId, id) { return this.repo.get(userId, id); }
  listAll(userId) { return this.repo.all(userId); }
  listForFilter(userId, f) { return this.repo.listForFilter(userId, f, new Date().toISOString()); }
  search(userId, q) { return this.repo.search(userId, q); }

  update(userId, id, fields) {
    if (fields && typeof fields.category === 'string') {
      if (![...CATEGORY_REGISTRY, FALLBACK_CATEGORY].some(c => c.name === fields.category)) {
        fields.category = FALLBACK_CATEGORY.name;
      }
    }
    return this.repo.update(userId, id, fields);
  }
  complete(userId, id) { return this.repo.update(userId, id, { status: 'done' }); }
  cancel(userId, id)   { return this.repo.update(userId, id, { status: 'cancelled' }); }
  reopen(userId, id)   { return this.repo.update(userId, id, { status: 'planned' }); }
  delete(userId, id)   { this.repo.delete(userId, id); }

  postpone(userId, id, opts) {
    const t = this.repo.get(userId, id);
    if (!t) return null;
    const tz = t.timezone || 'Europe/Moscow';
    const tzOffsets = { 'Europe/Moscow': 3 };
    const off = tzOffsets[tz] ?? 3;
    const cur = new Date(t.start_at);
    const local = new Date(cur.getTime() + off * 3600 * 1000);

    let next = new Date(local);
    if (opts.mode === 'hour' && opts.hours) next.setHours(next.getHours() + Number(opts.hours));
    else if (opts.mode === 'evening') { next.setHours(19, 0, 0, 0); if (next <= local) next.setDate(next.getDate() + 1); }
    else if (opts.mode === 'tomorrow') { next.setDate(next.getDate() + 1); next.setHours(10, 0, 0, 0); }
    else if (opts.mode === 'weekend') {
      const day = next.getDay();
      const add = (6 - day + 7) % 7 || 7;
      next.setDate(next.getDate() + add); next.setHours(11, 0, 0, 0);
    } else if (opts.mode === 'date' && opts.new_start) {
      const n = new Date(opts.new_start);
      const offN = tzOffsets[tz] ?? 3;
      next = new Date(n.getTime() - offN * 3600 * 1000);
    }

    const newUtc = new Date(next.getTime() - off * 3600 * 1000).toISOString();
    this.repo.incrementPostponed(userId, id);
    return this.repo.update(userId, id, { start_at: newUtc });
  }

  homeBuckets(userId) {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(now); endOfDay.setHours(23,59,59,999);
    const all = this.repo.all(userId);
    const overdue = all.filter(t => new Date(t.start_at) < startOfDay && (t.status === 'planned' || t.status === 'in_progress'));
    const day = all.filter(t => new Date(t.start_at) >= startOfDay && new Date(t.start_at) <= endOfDay && t.status !== 'cancelled' && t.status !== 'done');
    const nowTasks = [], soonTasks = [], laterTasks = [];
    for (const t of day) {
      const diff = (new Date(t.start_at) - now) / 60000;
      if (diff <= 30 && diff >= -30) nowTasks.push(t);
      else if (diff > 30 && diff <= 120) soonTasks.push(t);
      else laterTasks.push(t);
    }
    const done_today = all.filter(t => t.status === 'done' && new Date(t.start_at) >= startOfDay && new Date(t.start_at) <= endOfDay);
    return { overdue, now_tasks: nowTasks, soon_tasks: soonTasks, later_today: laterTasks, done_today };
  }
}

function normalizeCreate(p) {
  let cat = p.category || FALLBACK_CATEGORY.name;
  if (![...CATEGORY_REGISTRY, FALLBACK_CATEGORY].some(c => c.name === cat)) cat = FALLBACK_CATEGORY.name;
  return {
    title: String(p.title || '').trim(),
    description: p.description ?? null,
    start_at: p.start_at,
    end_at: p.end_at ?? null,
    timezone: p.timezone || 'Europe/Moscow',
    location: p.location ?? null,
    category: cat,
    priority: p.priority ?? 3,
    recurrence_rule: p.recurrence_rule || null,
    recurrence_parent_id: p.recurrence_parent_id ?? null,
    recurrence_until: p.recurrence_until ?? null,
    reminders: Array.isArray(p.reminders) ? p.reminders.map(Number).filter(Boolean) : [],
  };
}

// ---------- CalendarService ----------
export class CalendarService {
  constructor(taskRepo) { this.repo = taskRepo; this.userId = taskRepo.userId; }

  monthGrid(userId, year, month, tz) {
    const first = new Date(year, month - 1, 1);
    const firstDow = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(first.getDate() - firstDow);
    const cells = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const tasks = this.repo.inRange(userId, d.toISOString(), next.toISOString());
      cells.push({
        date: ymd,
        in_current_month: d.getMonth() === month - 1,
        is_today: d.getTime() === today.getTime(),
        tasks,
      });
    }
    return cells;
  }
  week(userId, anchorIso, tz) {
    const a = new Date(anchorIso);
    const dow = (a.getDay() + 6) % 7;
    const start = new Date(a); start.setDate(a.getDate() - dow); start.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      days.push({
        date: ymd,
        in_current_month: true,
        is_today: d.getTime() === today.getTime(),
        tasks: this.repo.inRange(userId, d.toISOString(), next.toISOString()),
      });
    }
    return days;
  }
  day(userId, anchorIso) {
    const a = new Date(anchorIso);
    const start = new Date(a); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(start.getDate() + 1);
    const ymd = start.toISOString().slice(0, 10);
    return { date: ymd, tasks: this.repo.inRange(userId, start.toISOString(), end.toISOString()) };
  }
}

// ---------- SettingsService ----------
export class SettingsService {
  constructor(repo) { this.repo = repo; }
  get(userId) { return this.repo.get(userId); }
  update(userId, fields) {
    if (fields.reminder_profile && !REMINDER_PROFILES[fields.reminder_profile]) {
      delete fields.reminder_profile;
    }
    return this.repo.save(userId, fields);
  }
  profiles() { return REMINDER_PROFILES; }
}

// ---------- ProfileService ----------
export class ProfileService {
  constructor(repo) { this.repo = repo; }
  get(userId) { return this.repo.get(userId); }
  update(userId, fields) {
    const cleaned = {};
    for (const k of ['name', 'occupation', 'avatar_emoji', 'bio']) {
      if (k in (fields || {})) cleaned[k] = fields[k];
    }
    return this.repo.save(userId, cleaned);
  }
}

// ---------- StatisticsService ----------
export class StatisticsService {
  constructor(taskRepo) { this.repo = taskRepo; this.userId = taskRepo.userId; }
  summary(userId, days = 7) {
    const all = this.repo.all(userId);
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const recent = all.filter(t => new Date(t.created_at) >= cutoff);
    const done = recent.filter(t => t.status === 'done').length;
    const cancelled = recent.filter(t => t.status === 'cancelled').length;
    const postponed = recent.filter(t => (t.postponed_count || 0) > 0).length;
    const byCategory = {};
    for (const t of recent) byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    const byDay = {};
    for (const t of recent.filter(t => t.status === 'done')) {
      const key = new Date(t.start_at).toISOString().slice(0, 10);
      byDay[key] = (byDay[key] || 0) + 1;
    }
    return {
      window_days: days,
      created: recent.length,
      done, cancelled, postponed,
      completion_rate: recent.length ? Math.round(done / recent.length * 1000) / 10 : 0,
      by_category: byCategory,
      by_day: byDay,
    };
  }
}

// ---------- BackupService ----------
import { mkdirSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class BackupService {
  constructor(taskRepo, dataDir) {
    this.repo = taskRepo;
    this.dir = join(dataDir, 'backups');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }
  create(userId) {
    const payload = { version: 1, count: 0, items: this.repo.all(userId) };
    payload.count = payload.items.length;
    const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0, 19);
    const name = `vse_dela_u${userId}_${ts}.json`;
    const filePath = join(this.dir, name);
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { name, created_at: new Date().toISOString() };
  }
  list(userId) {
    if (!existsSync(this.dir)) return [];
    
    const prefix = `vse_dela_u${userId}_`;
    return readdirSync(this.dir).filter(f => f.endsWith('.json') && (
      f.startsWith(prefix) || (userId === 1 && /^vse_dela_(?!u\d+_)/.test(f))
    )).map(f => {
      const filePath = join(this.dir, f);
      let size = 0;
      try { size = statSync(filePath).size; } catch {}
      return { name: f, size, created_at: null };
    });
  }
  import(userId, payload) {
    const items = payload?.items || [];
    let added = 0;
    for (const r of items) {
      if (!r.title || !r.start_at) continue;
      this.repo.add({
        user_id:userId,
        title: r.title,
        description: r.description || null,
        start_at: r.start_at,
        end_at: r.end_at || null,
        timezone: r.timezone || 'Europe/Moscow',
        location: r.location || null,
        category: r.category || 'Другое',
        priority: r.priority || 3,
        recurrence_rule: r.recurrence_rule || null,
        reminders: r.reminders || [],
        status: r.status || 'planned',
        source: r.source || 'web',
      });
      added += 1;
    }
    return added;
  }
}
