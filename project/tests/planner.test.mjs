import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeTask, parseNatural, dateKey, localInput, localToIso, filteredTasks, calendarDays, homeBuckets, postponedStart } from '../public/static/planner-core.js';
import { ReminderManager } from '../public/static/reminders.js';
import { initApi } from '../src/app.mjs';

const now = Date.parse('2026-10-12T21:30:00Z'); // Уже 13 октября по Москве.
const task = (id, start, fields = {}) => normalizeTask({ id, title: `Задача ${id}`, start_at: new Date(start).toISOString(), status: 'planned', ...fields });

test('Дефолт 60 минут, ручной выбор и явное отключение различаются', () => {
  assert.deepEqual(task(1, now).reminders, [60]);
  assert.deepEqual(task(1, now, { reminders: [] }).reminders, []);
  for (const minutes of [5, 15, 30, 60, 120, 1440]) assert.deepEqual(task(1, now, { reminders: [minutes] }).reminders, [minutes]);
  assert.throws(() => task(1, now, { reminders: [-1] }));
});

test('Календарь, поиск и фильтр Сегодня видят те же задачи на границе суток', () => {
  const items = [task(1, '2026-10-12T21:15:00Z'), task(2, '2026-10-12T20:00:00Z'), task(3, '2026-10-13T10:00:00Z', { status: 'done' })];
  const today = filteredTasks(items, 'today', '', 'Europe/Moscow', now);
  const calendar = calendarDays(items, now, 'day', 'Europe/Moscow', now)[0].tasks;
  assert.deepEqual(today.map(t => t.id), [1, 3]);
  assert.deepEqual(calendar.map(t => t.id), today.map(t => t.id));
  assert.deepEqual(filteredTasks(items, 'today', 'ЗАДАЧА 1', 'Europe/Moscow', now).map(t => t.id), [1]);
  assert.equal(homeBuckets(items, 'Europe/Moscow', now).done_today.length, 1);
  assert.equal(calendarDays(items, now, 'month', 'Europe/Moscow', now).length, 42);
});

test('Быстрый ввод понимает кириллицу, время, выбранные напоминания и дату', () => {
  const p = parseNatural('завтра в 10 позвонить маме, напомни за 15 минут', 'Europe/Moscow', now);
  assert.equal(p.title, 'позвонить маме');
  assert.equal(p.start_at, '2026-10-14T07:00:00.000Z');
  assert.deepEqual(p.reminders, [15]);
  assert.deepEqual(parseNatural('послезавтра в 18:30 встреча без напоминаний', 'Europe/Moscow', now).reminders, []);
  assert.deepEqual(parseNatural('сегодня в 14 встреча', 'Europe/Moscow', now).reminders, [60]);
  assert.deepEqual(parseNatural('сегодня в 14 встреча', 'Europe/Moscow', now, [30]).reminders, [30]);
  assert.deepEqual(parseNatural('завтра в 14 встреча, напомни за день', 'Europe/Moscow', now).reminders, [1440]);
  assert.throws(() => parseNatural('31.02.2026 в 10 встреча', 'Europe/Moscow', now));
});

test('Редактирование и перенос сохраняют время в выбранном часовом поясе', () => {
  assert.equal(dateKey(now, 'Europe/Moscow'), '2026-10-13');
  assert.equal(localToIso(localInput(now, 'Asia/Vladivostok'), 'Asia/Vladivostok'), new Date(now).toISOString());
  const t = task(1, now);
  const next = '2026-10-14T08:00:00Z';
  assert.equal(postponedStart(t, { mode: 'date', new_start: next }), new Date(next).toISOString());
});

function reminderFixture({ time = 1000000, enabled = true, delivered = true } = {}) {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const items = [task(1, time + 5 * 60000, { reminders: [5] })];
  const api = { reminderStorageKey: 'test', getSettings: async () => ({ reminders_enabled: enabled }), listTasks: async () => items };
  const calls = [], missed = [];
  const manager = new ReminderManager({ api, storage, now: () => time,
    notify: async entry => { calls.push(entry); return delivered; }, onChange: entries => { missed.splice(0, missed.length, ...entries); } });
  return { manager, calls, missed, items, storage, api };
}

test('Уведомление в момент напоминания показывается один раз, включая повторный запуск', async () => {
  const f = reminderFixture();
  await f.manager.check();
  await f.manager.check();
  assert.equal(f.calls.length, 1);
  const another = new ReminderManager({ api: f.api, storage: f.storage, now: () => 1000000, notify: async entry => { f.calls.push(entry); return true; }, onChange: () => {} });
  await another.check();
  assert.equal(f.calls.length, 1);
  assert.equal(f.missed.length, 0);
});

test('После закрытия/сна показываются пропущенные, а просмотр сохраняется', async () => {
  const f = reminderFixture();
  f.items[0].start_at = new Date(1000000 + 3 * 60000).toISOString();
  await f.manager.check();
  assert.equal(f.calls.length, 0);
  assert.equal(f.missed.length, 1);
  await f.manager.dismiss();
  await f.manager.check();
  assert.equal(f.missed.length, 0);
});

test('Запрет уведомлений даёт пропущенное, отключённый переключатель не отправляет', async () => {
  const failed = reminderFixture({ delivered: false });
  await failed.manager.check();
  assert.equal(failed.missed.length, 1);
  const disabled = reminderFixture({ enabled: false });
  await disabled.manager.check();
  assert.equal(disabled.calls.length, 0);
  assert.equal(disabled.missed.length, 0);
});

test('Завершение, удаление и перенос отменяют старые напоминания', async () => {
  for (const change of [items => { items[0].status = 'done'; }, items => { items.length = 0; }, items => { items[0].start_at = new Date(1000000 + 3600000).toISOString(); }]) {
    const f = reminderFixture({ delivered: false });
    await f.manager.check();
    change(f.items);
    await f.manager.check();
    assert.equal(f.missed.length, 0);
    assert.equal(f.calls.length, 1);
  }
});

test('SQLite: общий источник задач, сессии, дефолт и сохранение после перезапуска', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vovremya-test-'));
  try {
    const api = initApi({ dataDir: dir });
    const session = api.sessionStore.create();
    const request = async (path, method = 'GET', body, app = api) => {
      const { Readable } = await import('node:stream');
      const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      req.url = path; req.method = method;
      let status, result;
      const res = { writeHead(code) { status = code; }, end(raw) { result = raw ? JSON.parse(raw) : null; } };
      await app.handle(req, res, session);
      assert.ok(status < 400, `${method} ${path}: ${status} ${JSON.stringify(result)}`);
      return result;
    };
    const created = await request('/api/tasks', 'POST', { title: 'Календарная задача', start_at: '2026-10-12T21:30:00Z' });
    assert.deepEqual(created.reminders, [60]);
    assert.equal((await request('/api/tasks'))[0].id, created.id);
    assert.equal((await request('/api/calendar/day?anchor=2026-10-12T21:30:00Z&tz=Europe/Moscow')).tasks[0].id, created.id);
    await request(`/api/tasks/${created.id}/done`, 'POST');
    assert.equal((await request('/api/tasks?filter=done'))[0].id, created.id);
    await request('/api/tasks', 'POST', { title: 'Без напоминания', start_at: '2026-10-14T10:00:00Z', reminders: [] });
    const restored = initApi({ dataDir: dir });
    assert.equal(restored.sessionStore.get(session.token).user_id, session.user_id);
    assert.equal((await request('/api/tasks', 'GET', undefined, restored)).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
