// database.js — слой database на node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CATEGORIES = ['Личное', 'Работа', 'Семья', 'Здоровье', 'Обучение', 'Другое'];

export class Database {
  constructor(dataDir) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'vse_dela.db'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    // 1. Создаём таблицы (CREATE без user_id в tasks, чтобы ALTER работал чисто)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT,
        timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
        location TEXT,
        category TEXT NOT NULL DEFAULT 'Другое',
        priority INTEGER NOT NULL DEFAULT 3,
        recurrence_rule TEXT,
        recurrence_parent_id INTEGER,
        recurrence_until TEXT,
        reminders TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'planned',
        postponed_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'web',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL DEFAULT 1,
        timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
        theme_mode TEXT NOT NULL DEFAULT 'auto',
        language TEXT NOT NULL DEFAULT 'ru',
        morning_review_time TEXT NOT NULL DEFAULT '06:00',
        evening_plan_time TEXT NOT NULL DEFAULT '20:00',
        evening_stats_time TEXT NOT NULL DEFAULT '20:15',
        reminder_profile TEXT NOT NULL DEFAULT 'standard',
        default_reminders TEXT NOT NULL DEFAULT '[60]',
        telegram_sync_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        user_id INTEGER PRIMARY KEY,
        name TEXT,
        occupation TEXT,
        avatar_emoji TEXT,
        bio TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);

    // 2. Миграция: добавить user_id в tasks, если его нет
    const taskCols = this.db.prepare("PRAGMA table_info(tasks)").all();
    if (!taskCols.some(c => c.name === 'user_id')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)');
    }

    // 3. Служебные записи
    const row = this.db.prepare('SELECT id FROM user_settings WHERE user_id = 1').get();
    if (!row) {
      this.db.prepare('INSERT INTO user_settings (user_id, updated_at) VALUES (1, ?)').run(new Date().toISOString());
    }
    const prof = this.db.prepare('SELECT user_id FROM user_profile WHERE user_id = 1').get();
    if (!prof) {
      this.db.prepare('INSERT INTO user_profile (user_id, updated_at) VALUES (1, ?)').run(new Date().toISOString());
    }
    // Меняем прежний стандарт приложения, сохраняя напоминания уже созданных задач.
    if (this.db.prepare('PRAGMA user_version').get().user_version < 1) {
      this.db.exec("UPDATE user_settings SET default_reminders = '[60]' WHERE default_reminders = '[60,30]' AND reminder_profile = 'standard'");
      this.db.exec('PRAGMA user_version = 1');
    }
  }
}

export { CATEGORIES };
