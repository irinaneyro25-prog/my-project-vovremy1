// repositories.js — слой repositories, доступ к БД
import { CATEGORIES } from './db.mjs';
import { randomBytes } from 'node:crypto';

function nowIso() { return new Date().toISOString(); }

function rowToTask(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    description: r.description,
    start_at: r.start_at,
    end_at: r.end_at,
    timezone: r.timezone,
    location: r.location,
    category: r.category,
    priority: r.priority,
    recurrence_rule: r.recurrence_rule,
    recurrence_parent_id: r.recurrence_parent_id,
    recurrence_until: r.recurrence_until,
    reminders: JSON.parse(r.reminders || '[]'),
    status: r.status,
    postponed_count: r.postponed_count,
    source: r.source,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export class TaskRepository {
  constructor(db) { this.db = db; }

  add({ user_id = 1, title, description = null, start_at, end_at = null, timezone = 'Europe/Moscow',
        location = null, category = 'Другое', priority = 3, recurrence_rule = null,
        recurrence_parent_id = null, recurrence_until = null, reminders = [],
        status = 'planned', source = 'web' }) {
    const cat = CATEGORIES.includes(category) ? category : 'Другое';
    const pr = Math.max(1, Math.min(5, Number(priority) || 3));
    const stmt = this.db.prepare(`
      INSERT INTO tasks (user_id, title, description, start_at, end_at, timezone, location, category, priority,
                         recurrence_rule, recurrence_parent_id, recurrence_until, reminders,
                         status, postponed_count, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const now = nowIso();
    const res = stmt.run(user_id, title, description, start_at, end_at, timezone, location, cat, pr,
                         recurrence_rule, recurrence_parent_id, recurrence_until,
                         JSON.stringify(reminders || []), status, source, now, now);
    return this.get(user_id, res.lastInsertRowid);
  }

  get(userId, id) {
    return rowToTask(this.db.prepare('SELECT * FROM tasks WHERE user_id = ? AND id = ?').get(userId, id));
  }

  delete(userId, id) {
    this.db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?').run(userId, id);
  }

  all(userId) {
    return this.db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY start_at ASC')
      .all(userId).map(rowToTask);
  }

  inRange(userId, startIso, endIso) {
    return this.db.prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at ASC'
    ).all(userId, startIso, endIso).map(rowToTask);
  }

  overdue(userId, beforeIso) {
    return this.db.prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND start_at < ? AND status IN ('planned','in_progress')
       ORDER BY start_at ASC`
    ).all(userId, beforeIso).map(rowToTask);
  }

  listForFilter(userId, filter, nowIso) {
    const { startOfDay, endOfDay, startOfWeek, endOfWeek } = datesForFilter(nowIso);
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    const args = [userId];
    const where = [];
    switch (filter) {
      case 'today':
        where.push('start_at >= ?'); args.push(startOfDay);
        where.push('start_at < ?');  args.push(endOfDay);
        where.push("status != 'cancelled'");
        break;
      case 'tomorrow':
        where.push('start_at >= ?'); args.push(addDays(startOfDay, 1));
        where.push('start_at < ?');  args.push(addDays(endOfDay, 1));
        where.push("status != 'cancelled'");
        break;
      case 'week':
        where.push('start_at >= ?'); args.push(startOfWeek);
        where.push('start_at < ?');  args.push(endOfWeek);
        where.push("status != 'cancelled'");
        break;
      case 'postponed':
        where.push('postponed_count > 0');
        where.push("status != 'done'");
        break;
      case 'done':
        where.push("status = 'done'");
        break;
      case 'undated': break;
      case 'p1': where.push('priority = 1'); where.push("status != 'done'"); break;
      case 'p2': where.push('priority = 2'); where.push("status != 'done'"); break;
      case 'p3': where.push('priority = 3'); where.push("status != 'done'"); break;
      case 'p4': where.push('priority = 4'); where.push("status != 'done'"); break;
      case 'p5': where.push('priority = 5'); where.push("status != 'done'"); break;
      case 'important':
        where.push('priority <= 2');
        where.push("status != 'done'");
        break;
    }
    if (where.length) sql += ' AND ' + where.join(' AND ');
    sql += ' ORDER BY start_at ASC';
    return this.db.prepare(sql).all(...args).map(rowToTask);
  }

  search(userId, q) {
    if (!q) return this.all(userId);
    const like = `%${q.toLowerCase()}%`;
    return this.db.prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND (LOWER(title) LIKE ? OR LOWER(IFNULL(description,'')) LIKE ?
         OR LOWER(IFNULL(location,'')) LIKE ? OR LOWER(category) LIKE ?)
       ORDER BY start_at ASC`
    ).all(userId, like, like, like, like).map(rowToTask);
  }

  update(userId, id, fields) {
    const allowed = ['title','description','start_at','end_at','timezone','location','category',
                     'priority','recurrence_rule','recurrence_parent_id','recurrence_until',
                     'reminders','status','postponed_count','source'];
    const sets = [];
    const args = [];
    for (const k of Object.keys(fields || {})) {
      if (!allowed.includes(k)) continue;
      let v = fields[k];
      if (k === 'category' && !CATEGORIES.includes(v)) v = 'Другое';
      if (k === 'priority' && v != null) v = Math.max(1, Math.min(5, Number(v)));
      if (k === 'reminders' && v != null) v = JSON.stringify(v);
      sets.push(`${k} = ?`);
      args.push(v);
    }
    if (!sets.length) return this.get(userId, id);
    sets.push('updated_at = ?');
    args.push(nowIso());
    args.push(userId, id);
    const r = this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`).run(...args);
    if (r.changes === 0) return null;
    return this.get(userId, id);
  }

  incrementPostponed(userId, id) {
    this.db.prepare('UPDATE tasks SET postponed_count = postponed_count + 1, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(nowIso(), userId, id);
  }
}

export class SettingsRepository {
  constructor(db) { this.db = db; }
  get(userId = 1) {
    const r = this.db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    if (!r) return null;
    return {
      timezone: r.timezone,
      theme_mode: r.theme_mode,
      language: r.language,
      morning_review_time: r.morning_review_time,
      evening_plan_time: r.evening_plan_time,
      evening_stats_time: r.evening_stats_time,
      reminder_profile: r.reminder_profile,
      default_reminders: JSON.parse(r.default_reminders || '[]'),
      telegram_sync_enabled: !!r.telegram_sync_enabled,
    };
  }
  save(userId, fields) {
    const allowed = ['timezone','theme_mode','language','morning_review_time','evening_plan_time',
                     'evening_stats_time','reminder_profile','default_reminders','telegram_sync_enabled'];
    const sets = []; const args = [];
    for (const k of Object.keys(fields || {})) {
      if (!allowed.includes(k)) continue;
      let v = fields[k];
      if (k === 'default_reminders' && v != null) v = JSON.stringify(v);
      if (k === 'telegram_sync_enabled' && v != null) v = v ? 1 : 0;
      sets.push(`${k} = ?`); args.push(v);
    }
    if (!sets.length) return this.get(userId);
    sets.push('updated_at = ?'); args.push(nowIso());
    this.db.prepare(`UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...args, userId);
    return this.get(userId);
  }
}

export class ProfileRepository {
  constructor(db) { this.db = db; }
  get(userId = 1) {
    const r = this.db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
    if (!r) return { name: null, occupation: null, avatar_emoji: '🌿', bio: null };
    return {
      name: r.name || null,
      occupation: r.occupation || null,
      avatar_emoji: r.avatar_emoji || '🌿',
      bio: r.bio || null,
    };
  }
  save(userId, fields) {
    const allowed = ['name', 'occupation', 'avatar_emoji', 'bio'];
    const sets = []; const args = [];
    for (const k of Object.keys(fields || {})) {
      if (!allowed.includes(k)) continue;
      let v = fields[k];
      if (typeof v === 'string') v = v.trim() || null;
      sets.push(`${k} = ?`); args.push(v);
    }
    if (!sets.length) return this.get(userId);
    sets.push('updated_at = ?'); args.push(nowIso());
    this.db.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE user_id = ?`).run(...args, userId);
    return this.get(userId);
  }
}

export class SessionRepository {
  constructor(db) { this.db = db; }

  create(userId = null, ttlDays = 365) {
    if (!Number.isSafeInteger(userId) || userId < 1) {
      const row = this.db.prepare(`
        SELECT MAX(user_id) max_id FROM (
          SELECT user_id FROM sessions
          UNION ALL SELECT user_id FROM user_settings
          UNION ALL SELECT user_id FROM user_profile
          UNION ALL SELECT user_id FROM tasks
        )
      `).get();
      userId = Number(row?.max_id || 0) + 1;
    }
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + ttlDays * 86400 * 1000);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run(token, userId, now.toISOString(), expires.toISOString());
      this.db.prepare('INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)').run(userId, now.toISOString());
      this.db.prepare('INSERT OR IGNORE INTO user_profile (user_id, updated_at) VALUES (?, ?)').run(userId, now.toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { token, user_id: userId, expires_at: expires.toISOString() };
  }

  get(token) {
    if (!token) return null;
    const r = this.db.prepare(
      'SELECT token, user_id, expires_at FROM sessions WHERE token = ?'
    ).get(token);
    if (!r) return null;
    if (new Date(r.expires_at) < new Date()) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return { token: r.token, user_id: r.user_id, expires_at: r.expires_at };
  }

  destroy(token) {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

function startOfDayLocal(d = new Date()) {
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}
function endOfDayLocal(d = new Date()) {
  const x = new Date(d); x.setHours(23,59,59,999); return x;
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function startOfWeekLocal(d = new Date()) {
  const x = startOfDayLocal(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function endOfWeekLocal(d = new Date()) {
  return addDays(startOfWeekLocal(d), 7);
}
function datesForFilter(nowIso) {
  const now = new Date(nowIso);
  return {
    startOfDay: startOfDayLocal(now).toISOString(),
    endOfDay:   endOfDayLocal(now).toISOString(),
    startOfWeek: startOfWeekLocal(now).toISOString(),
    endOfWeek:   endOfWeekLocal(now).toISOString(),
  };
}
