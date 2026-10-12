// services.js — слой services, бизнес-логика

const REMINDER_PROFILES = {
  soft:     { label: 'Мягкий',   values: [60] },
  standard: { label: 'Стандарт', values: [60] },
  early:    { label: 'Ранний',   values: [120, 30] },
};

export { REMINDER_PROFILES };

import { CATEGORIES as CATEGORY_REGISTRY, parseNatural, normalizeTask, filteredTasks, homeBuckets, calendarDays, postponedStart } from '../public/static/planner-core.js';
export { CATEGORY_REGISTRY };

// ---------- TaskService ----------
export class TaskService {
  constructor(taskRepo, settingsRepo = null) { this.repo = taskRepo; this.userId = taskRepo.userId; this.settingsRepo = settingsRepo; }

  categories() {
    return CATEGORY_REGISTRY;
  }

  create(userId, payload, source = 'web') {
    const p = normalizeTask({ ...payload, reminders: payload.reminders === undefined ? (this.settingsRepo?.get(userId)?.default_reminders || [60]) : payload.reminders });
    return this.repo.add({ user_id: userId, ...p, source });
  }
  createFromText(userId, text, tz) {
    const p = parseNatural(text, tz, Date.now(), this.settingsRepo?.get(userId)?.default_reminders);
    if (!p) throw new Error('не удалось разобрать текст');
    return this.create(userId, p);
  }
  previewFromText(text, tz, userId) {
    return parseNatural(text, tz, Date.now(), this.settingsRepo?.get(userId)?.default_reminders);
  }
  get(userId, id) { return this.repo.get(userId, id); }
  listAll(userId) { return this.repo.all(userId); }
  listForFilter(userId, f, q = '') { return filteredTasks(this.repo.all(userId), f, q, this.settingsRepo?.get(userId)?.timezone); }
  search(userId, q) { return this.listForFilter(userId, 'all', q); }

  update(userId, id, fields) {
    const current = this.repo.get(userId, id);
    if (!current) return null;
    return this.repo.update(userId, id, normalizeTask({ ...current, ...fields }));
  }
  complete(userId, id) { return this.repo.update(userId, id, { status: 'done' }); }
  cancel(userId, id)   { return this.repo.update(userId, id, { status: 'cancelled' }); }
  reopen(userId, id)   { return this.repo.update(userId, id, { status: 'planned' }); }
  delete(userId, id)   { this.repo.delete(userId, id); }

  postpone(userId, id, opts) {
    const task = this.repo.get(userId, id);
    if (!task) return null;
    return this.repo.update(userId, id, { start_at: postponedStart(task, opts), postponed_count: (task.postponed_count || 0) + 1 });
  }
  homeBuckets(userId) { return homeBuckets(this.repo.all(userId), this.settingsRepo?.get(userId)?.timezone); }
}

// ---------- CalendarService ----------
export class CalendarService {
  constructor(taskRepo) { this.repo = taskRepo; }
  monthGrid(userId, year, month, tz = 'Europe/Moscow') {
    return calendarDays(this.repo.all(userId), `${year}-${String(month).padStart(2, '0')}-15T12:00:00Z`, 'month', tz);
  }
  week(userId, anchorIso, tz = 'Europe/Moscow') { return calendarDays(this.repo.all(userId), anchorIso, 'week', tz); }
  day(userId, anchorIso, tz = 'Europe/Moscow') { return calendarDays(this.repo.all(userId), anchorIso, 'day', tz)[0]; }
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
    const name = `vovremya_u${userId}_${ts}.json`;
    const filePath = join(this.dir, name);
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { name, created_at: new Date().toISOString() };
  }
  list(userId) {
    if (!existsSync(this.dir)) return [];
    
    const prefix = `vovremya_u${userId}_`;
    return readdirSync(this.dir).filter(f => f.endsWith('.json') && (
      f.startsWith(prefix) || f.startsWith(`vse_dela_u${userId}_`) || (userId === 1 && /^vse_dela_(?!u\d+_)/.test(f))
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
