import { dateKey, normalizeTask } from './planner-core.js';

const FORMAT = 'vovremya.tasks';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function serializeTaskBackup(tasks) {
  return JSON.stringify({ format: FORMAT, version: 1, exported_at: new Date().toISOString(), tasks }, null, 2);
}

export function parseTaskBackup(raw) {
  let backup;
  try { backup = JSON.parse(raw); }
  catch { throw new Error('Не удалось прочитать файл JSON'); }
  if (backup?.format !== FORMAT || backup.version !== 1 || !Array.isArray(backup.tasks)) {
    throw new Error('Выберите файл резервной копии задач «Вовремя» версии 1');
  }

  const ids = new Set();
  return backup.tasks.map((task, index) => {
    try {
      if (typeof task?.id !== 'string' || !task.id.trim() || ids.has(task.id)) throw new Error();
      if (typeof task.title !== 'string' || !task.title.trim()) throw new Error();
      if (typeof task.start_at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(task.start_at) ||
          !dateKey(task.start_at, task.timezone)) throw new Error();
      if (!['planned', 'in_progress', 'done', 'cancelled'].includes(task.status)) throw new Error();
      if (!Array.isArray(task.reminders) || task.reminders.some(value => typeof value !== 'number')) throw new Error();
      const checked = normalizeTask(task);
      ids.add(task.id);
      return { ...task, start_at: checked.start_at, timezone: checked.timezone, reminders: checked.reminders };
    } catch {
      throw new Error(`Не удалось проверить задачу №${index + 1}. Восстановление отменено`);
    }
  });
}

export function planTaskRestore(existing, incoming) {
  const existingIds = new Set(existing.map(task => task.id));
  const added = incoming.filter(task => !existingIds.has(task.id));
  return { added, skipped: incoming.length - added.length };
}
