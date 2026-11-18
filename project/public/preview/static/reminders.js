export function reminderEntries(tasks) {
  return tasks.filter(t => !['done', 'cancelled'].includes(t.status) && Number.isFinite(Date.parse(t.start_at)))
    .flatMap(task => (task.reminders || []).map(minutes => ({
      key: `${task.id}|${task.start_at}|${minutes}`,
      taskId: task.id, title: task.title, start: task.start_at,
      due: Date.parse(task.start_at) - Number(minutes) * 60000,
    }))).filter(entry => Number.isFinite(entry.due));
}

export function dueReminders(tasks, ledger, now = Date.now()) {
  return reminderEntries(tasks).filter(entry => entry.due <= now && !ledger.entries[entry.key]);
}

export class ReminderManager {
  constructor({ api, notify, onChange, now = () => Date.now(), storage = localStorage }) {
    this.api = api;
    this.notify = notify;
    this.onChange = onChange;
    this.now = now;
    this.storage = storage;
    this.running = false;
    this.enabled = false;
  }
  read() {
    const raw = this.storage.getItem(this.api.reminderStorageKey);
    return raw ? JSON.parse(raw) : { entries: {}, last_check: 0 };
  }
  write(ledger) { this.storage.setItem(this.api.reminderStorageKey, JSON.stringify(ledger)); }
  async check() {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.api.getSettings();
      this.enabled = settings.reminders_enabled;
      const tasks = await this.api.listTasks();
      const run = async () => {
        const ledger = this.read();
        const now = this.now();
        // При переносе, удалении и завершении старое напоминание исчезает.
        const active = new Set(reminderEntries(tasks).map(e => e.key));
        for (const key of Object.keys(ledger.entries)) if (!active.has(key)) delete ledger.entries[key];
        if (this.enabled) {
          for (const entry of dueReminders(tasks, ledger, now)) {
            // После сна/закрытия не выдаём запоздалое уведомление за точное.
            const late = now - entry.due > 60000;
            let delivered = false;
            if (!late) {
              try { delivered = await this.notify(entry); } catch { delivered = false; }
            }
            ledger.entries[entry.key] = { ...entry, status: delivered ? 'delivered' : 'missed' };
          }
        }
        ledger.last_check = now;
        this.write(ledger);
        this.onChange(Object.values(ledger.entries).filter(e => e.status === 'missed'), settings);
      };
      // Общий журнал + Web Locks предотвращают дубли уведомлений в двух вкладках.
      if (globalThis.navigator?.locks) await navigator.locks.request(this.api.reminderStorageKey, run);
      else await run();
    } finally { this.running = false; }
  }
  async dismiss() {
    const run = () => {
      const ledger = this.read();
      for (const entry of Object.values(ledger.entries)) if (entry.status === 'missed') entry.status = 'dismissed';
      this.write(ledger);
    };
    if (globalThis.navigator?.locks) await navigator.locks.request(this.api.reminderStorageKey, run);
    else run();
    await this.check();
  }
  start(onError) {
    const check = () => this.check().catch(onError);
    check();
    this.timer = setInterval(check, 15000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('plannerchange', check);
    window.addEventListener('storage', check);
  }
}

export function notificationStatus() {
  if (!globalThis.isSecureContext) return 'Уведомления доступны при открытии приложения по HTTPS.';
  if (!('Notification' in globalThis)) return 'Этот браузер не поддерживает уведомления. На iPhone может потребоваться установка приложения на главный экран.';
  if (Notification.permission === 'denied') return 'Уведомления запрещены. Разрешите их в настройках браузера для этого сайта.';
  if (Notification.permission === 'default') return 'Для уведомлений нужно ваше разрешение.';
  return 'Браузеру разрешено показывать уведомления.';
}

export async function requestNotificationPermission() {
  if (!globalThis.isSecureContext || !('Notification' in globalThis)) return false;
  // Вызывается только из обработчика действия пользователя.
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  return permission === 'granted';
}

export async function showBrowserNotification(entry, registration, formatTime) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') return false;
  const icon = new URL('../icons/icon-192.png', import.meta.url).href;
  const options = { body: `${entry.title} · ${formatTime(entry.start)}`, tag: entry.key, icon, badge: icon,
    data: { url: new URL('../index.html#tasks', import.meta.url).href } };
  if (registration) await registration.showNotification('Вовремя — напоминание', options);
  else new Notification('Вовремя — напоминание', options);
  return true;
}
