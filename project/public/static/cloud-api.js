const PROJECT_URL = 'https://sxmaumiqmujgjzelxdrz.supabase.co';
const SESSION_KEY = 'vovremya.cloud.session.v1';
const TASK_FIELDS = ['id', 'title', 'description', 'start_at', 'end_at', 'timezone',
  'location', 'category', 'priority', 'recurrence_rule', 'recurrence_parent_id',
  'recurrence_until', 'reminders', 'status', 'postponed_count', 'created_at', 'updated_at'];
const EDITABLE_FIELDS = TASK_FIELDS.filter(key => !['id', 'created_at', 'updated_at'].includes(key));

export function createCloudApi(publishableKey) {
  let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  let refreshing = null;
  const table = '/rest/v1/planner_tasks';
  const select = 'select=' + TASK_FIELDS.join(',');
  const fields = task => Object.fromEntries(TASK_FIELDS.filter(key => key in task).map(key => [key, task[key]]));
  const editable = task => Object.fromEntries(EDITABLE_FIELDS.filter(key => key in task).map(key => [key, task[key]]));
  const taskPath = id => table + '?id=eq.' + encodeURIComponent(id) + '&' + select;

  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(PROJECT_URL + path, {
        method: options.method || 'GET',
        headers: {
          apikey: publishableKey,
          'content-type': 'application/json',
          ...(options.token ? { authorization: 'Bearer ' + options.token } : {}),
          ...(options.prefer ? { prefer: options.prefer } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new Error('Нет связи с облаком. Проверьте интернет и повторите действие');
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error(data?.msg || data?.error_description || data?.message || data?.error ||
        'Ошибка облака (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refresh() {
    if (!session?.refresh_token) throw new Error('Войдите в облачный аккаунт');
    if (!refreshing) {
      refreshing = request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token },
      }).then(saveSession).finally(() => { refreshing = null; });
    }
    await refreshing;
  }

  async function authorized(path, options) {
    if (!session) throw new Error('Войдите в облачный аккаунт');
    if (Date.now() >= session.expires_at * 1000 - 60000) await refresh();
    try {
      return await request(path, { ...options, token: session.access_token });
    } catch (error) {
      if (error.status !== 401) throw error;
      await refresh();
      return request(path, { ...options, token: session.access_token });
    }
  }

  return {
    get userId() { return session?.user?.id || null; },
    async init() {
      if (!session) return false;
      const user = await authorized('/auth/v1/user');
      if (user.id !== session.user?.id) throw new Error('Не удалось проверить облачный аккаунт');
      return true;
    },
    async signIn(email, password) {
      const value = await request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email, password },
      });
      saveSession(value);
    },
    async signOut() {
      try { if (session) await authorized('/auth/v1/logout', { method: 'POST' }); }
      finally { saveSession(null); }
    },
    listTasks: () => authorized(table + '?' + select + '&order=start_at.asc'),
    async getTask(id) { return (await authorized(taskPath(id)))[0]; },
    async createTask(task) {
      const rows = await authorized(table + '?' + select, {
        method: 'POST', body: fields(task), prefer: 'return=representation',
      });
      return rows[0];
    },
    async updateTask(id, task) {
      const rows = await authorized(taskPath(id), {
        method: 'PATCH', body: editable(task), prefer: 'return=representation',
      });
      if (!rows.length) throw new Error('Задача не найдена в облаке');
      return rows[0];
    },
    async deleteTask(id) {
      const rows = await authorized(taskPath(id), { method: 'DELETE', prefer: 'return=representation' });
      if (!rows.length) throw new Error('Задача не найдена в облаке');
    },
    async importTasks(tasks) {
      if (!tasks.length) return 0;
      let count = 0;
      for (let offset = 0; offset < tasks.length; offset += 100) {
        const rows = tasks.slice(offset, offset + 100).map(task => ({
          ...fields(task), owner_id: session.user.id,
        }));
        const inserted = await authorized(table + '?on_conflict=owner_id,id&select=id', {
          method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation',
        });
        count += inserted.length;
      }
      return count;
    },
    telegramStatus: () => authorized('/functions/v1/telegram/status'),
    telegramLink: () => authorized('/functions/v1/telegram/link', { method: 'POST' }),
    telegramPrivacy: privacy => authorized('/functions/v1/telegram/privacy', {
      method: 'POST', body: { privacy },
    }),
    telegramUnlink: () => authorized('/functions/v1/telegram/unlink', { method: 'POST' }),
  };
}
