import { CATEGORIES, normalizeTask, parseNatural, filteredTasks, homeBuckets, calendarDays, postponedStart } from './planner-core.js';

const LOCAL_KEY = 'vovremya.planner.v1';
const DEFAULT_SETTINGS = { timezone: 'Europe/Moscow', theme_mode: 'auto', default_reminders: [60] };
const root = new URL('../', import.meta.url);

function readLocal() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return { tasks: [], settings: { ...DEFAULT_SETTINGS }, profile: {} };
  // Повреждённое хранилище не перезаписываем пустым списком.
  const data = JSON.parse(raw);
  if (!Array.isArray(data.tasks) || !data.settings || !data.profile) throw new Error('Не удалось прочитать сохранённые задачи');
  return data;
}
function saveLocal(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }
  catch { throw new Error('Браузер не смог сохранить данные. Проверьте свободное место и доступ к хранилищу'); }
}

export function createPlannerApi() {
  let mode = null;
  let identity = 'local';
  let initialized = false;
  const requireReady = () => { if (!initialized) throw new Error('Хранилище задач ещё не готово. Обновите страницу'); };
  const changed = () => window.dispatchEvent(new Event('plannerchange'));
  async function req(path, opts = {}) {
    const response = await fetch(new URL(path.replace(/^\//, ''), root), {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.error || `Ошибка сервера (${response.status})`);
    if (response.status !== 204 && data === null) throw new Error('Сервер вернул некорректный ответ');
    return data;
  }
  const deviceKey = () => `vovremya.notifications.${identity}`;
  const localMutation = fn => {
    requireReady();
    const data = readLocal();
    const result = fn(data);
    saveLocal(data);
    changed();
    return result;
  };
  async function mutation(path, opts, localFn) {
    requireReady();
    const result = mode === 'server' ? await req(path, opts) : localMutation(localFn);
    if (mode === 'server') changed();
    return result;
  }
  const api = {
    get mode() { return mode; },
    get reminderStorageKey() { return `vovremya.reminder-ledger.${identity}`; },
    async init() {
      let response;
      try { response = await fetch(new URL('api/health', root), { credentials: 'same-origin' }); }
      catch (error) {
        if (localStorage.getItem('vovremya.storage-mode') !== 'local') throw error;
        mode = 'local'; readLocal(); initialized = true; return;
      }
      if (response.status === 503 && localStorage.getItem('vovremya.storage-mode') === 'local' && !navigator.onLine) {
        mode = 'local'; readLocal(); initialized = true; return;
      }
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.includes('application/json')) {
        const data = await response.json();
        if (data.ok !== true) throw new Error('Сервис временно недоступен');
        mode = 'server';
        const profile = await req('/api/profile');
        identity = `server-${profile.user_id}`;
      } else if ([404, 405].includes(response.status) || (response.ok && type.includes('text/html'))) {
        mode = 'local';
        readLocal();
      } else throw new Error('Не удалось подключиться к хранилищу задач. Попробуйте обновить страницу');
      localStorage.setItem('vovremya.storage-mode', mode);
      initialized = true;
    },
    categories: async () => CATEGORIES,
    async listTasks(filter = 'all', q = '') {
      requireReady();
      const tasks = mode === 'server' ? await req('/api/tasks') : readLocal().tasks;
      const settings = await api.getSettings();
      return filteredTasks(tasks, filter, q, settings.timezone);
    },
    async getTask(id) { requireReady(); return mode === 'server' ? req(`/api/tasks/${id}`) : readLocal().tasks.find(t => t.id === id); },
    async createTask(payload) {
      const settings = await api.getSettings();
      const task = normalizeTask({ timezone: settings.timezone, ...payload,
        reminders: payload.reminders === undefined ? settings.default_reminders : payload.reminders });
      return mutation('/api/tasks', { method: 'POST', body: task }, data => {
        const now = new Date().toISOString();
        const created = { status: 'planned', postponed_count: 0, priority: 3, ...task, id: crypto.randomUUID(), created_at: now, updated_at: now };
        data.tasks.push(created);
        return created;
      });
    },
    async updateTask(id, fields) {
      const current = await api.getTask(id);
      if (!current) throw new Error('Задача не найдена');
      const updated = normalizeTask({ ...current, ...fields });
      return mutation(`/api/tasks/${id}`, { method: 'PATCH', body: updated }, data => {
        const index = data.tasks.findIndex(t => t.id === id);
        if (index < 0) throw new Error('Задача не найдена');
        data.tasks[index] = { ...normalizeTask({ ...data.tasks[index], ...fields }), updated_at: new Date().toISOString() };
        return data.tasks[index];
      });
    },
    deleteTask: id => mutation(`/api/tasks/${id}`, { method: 'DELETE' }, data => { data.tasks = data.tasks.filter(t => t.id !== id); }),
    completeTask: id => api.updateTask(id, { status: 'done' }),
    reopenTask: id => api.updateTask(id, { status: 'planned' }),
    cancelTask: id => api.updateTask(id, { status: 'cancelled' }),
    async postpone(id, opts) {
      const task = await api.getTask(id);
      return api.updateTask(id, { start_at: postponedStart(task, opts), postponed_count: (task.postponed_count || 0) + 1 });
    },
    quickPreview: async (text, tz) => parseNatural(text, tz, Date.now(), (await api.getSettings()).default_reminders),
    quickAdd: async (text, tz) => api.createTask(await api.quickPreview(text, tz)),
    async home() { const s = await api.getSettings(); return homeBuckets(await api.listTasks(), s.timezone); },
    async calendarWeek(anchor, tz) { return { days: calendarDays(await api.listTasks(), anchor, 'week', tz) }; },
    async calendarMonth(y, m, tz) { return { cells: calendarDays(await api.listTasks(), `${y}-${String(m).padStart(2, '0')}-15T12:00:00Z`, 'month', tz) }; },
    async calendarDay(anchor, tz) { return calendarDays(await api.listTasks(), anchor, 'day', tz)[0]; },
    async getSettings() {
      requireReady();
      const settings = mode === 'server' ? await req('/api/settings') : readLocal().settings;
      return { ...DEFAULT_SETTINGS, ...settings, reminders_enabled: localStorage.getItem(deviceKey()) === 'enabled' };
    },
    async saveSettings(fields) {
      requireReady();
      const { reminders_enabled, ...shared } = fields;
      if (Object.keys(shared).length) {
        if (mode === 'server') await req('/api/settings', { method: 'PATCH', body: shared });
        else localMutation(data => { Object.assign(data.settings, shared); });
      }
      if (reminders_enabled !== undefined) localStorage.setItem(deviceKey(), reminders_enabled ? 'enabled' : 'disabled');
      changed();
      return api.getSettings();
    },
    async getProfile() { requireReady(); return mode === 'server' ? req('/api/profile') : readLocal().profile; },
    saveProfile: fields => mutation('/api/profile', { method: 'PUT', body: fields }, data => { Object.assign(data.profile, fields); return data.profile; }),
  };
  return api;
}
