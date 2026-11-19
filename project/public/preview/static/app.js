import { createPlannerApi } from './planner-api.js';
import { MAX_BACKUP_BYTES } from './task-backup.js';
import { REMINDER_OPTIONS, dateKey, localInput, localToIso } from './planner-core.js';
import { ReminderManager, notificationStatus, requestNotificationPermission, showBrowserNotification } from './reminders.js';
import { icon, fillIcons } from './icons.js';

// === утилиты ===
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = {
  dateTime(iso, tz = "Europe/Moscow") {
    try { return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
    catch { return new Date(iso).toLocaleString("ru-RU"); }
  },
  date(iso, tz = "Europe/Moscow") {
    try { return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)); }
    catch { return new Date(iso).toLocaleDateString("ru-RU"); }
  },
  time(iso, tz = "Europe/Moscow") {
    try { return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
    catch { return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
  },
  dayMonth(iso, tz = "Europe/Moscow") {
    try { return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "long", weekday: "long" }).format(new Date(iso)); }
    catch { return new Date(iso).toLocaleDateString("ru-RU"); }
  },
  monthYear(year, month) {
    const d = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(d);
  },
};
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function toLocalInput(iso) { return localInput(iso, state.settings.timezone); }
function fromLocalInput(value) { return localToIso(value, state.settings.timezone); }
function reminderTimingHint(localStart, reminders) {
  const start = fromLocalInput(localStart);
  if (!start || !reminders.length) return '';
  return reminders.some(minutes => Date.parse(start) - minutes * 60000 <= Date.now())
    ? 'Время выбранного напоминания уже прошло. Выберите другое время или вариант «Без», иначе сообщение может не прийти.'
    : '';
}
function priorityLabel(p) {
  return ["Срочно и важно", "Важно, не срочно", "Срочно, не важно", "Можно позже", "Можно позже"][(p || 3) - 1] || "Срочно, не важно";
}
function reminderLabel(min) {
  if (min < 60) return `за ${min} мин`;
  if (min === 1440) return "за 1 день";
  if (min === 60) return "за 1 час";
  if (min === 90) return "за 1,5 часа";
  if (min === 120) return "за 2 часа";
  if (min % 60 === 0) return `за ${min / 60} ч`;
  return `за ${min} мин`;
}

// === API ===
const api = createPlannerApi();

// === состояние ===
const state = {
  settings: { timezone: "Europe/Moscow", theme_mode: "auto", default_reminders: [60], reminders_enabled: false },
  profile: { name: null, occupation: null, avatar_emoji: "🌿", bio: null },
  categories: [],
  calMode: window.innerWidth <= 720 ? "month" : "week",
  calAnchor: new Date(),
  filter: "all",
  search: "",
  categoryFilter: "",
  importanceFilter: "",
  urgencyFilter: "",
  priorityFilter: 0,
  tasks: [],
  editingId: null,
  route: "home",
};
const CAT_FALLBACK = { name: "Другое", emoji: "⚪", color: "#9aa0aa" };
const CATEGORY_ICONS = { 'Медицина': 0, 'Здоровье': 0, 'Семья': 1, 'Работа': 2, 'Дом': 3, 'Дети': 4 };
function categoryBadge(name) {
  const category = catInfo(name);
  const chosen = { medical: 0, family: 1, work: 2, home: 3, kids: 4 }[category.icon];
  const index = chosen ?? CATEGORY_ICONS[name];
  const color = /^#[0-9a-f]{6}$/i.test(category.color) ? category.color : '#8b77ad';
  return index === undefined ? '' : `<span class="category-icon icon-${index}" style="border-bottom-color:${color}" aria-hidden="true"></span>`;
}
function catInfo(name) { return state.categories.find(c => c.name === name) || CAT_FALLBACK; }
function categoryOptions() { return state.categories.length ? state.categories : [CAT_FALLBACK]; }

let toastTimer = null;
function toast(text, kind = "ok") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(kind);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

// === тема ===
function effectiveTheme(mode) {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  const h = new Date().getHours();
  return (h >= 20 || h < 7) ? "dark" : "light";
}
function applyTheme() {
  const t = effectiveTheme(state.settings.theme_mode || "auto");
  document.documentElement.dataset.theme = t;
  const labels = { light: "Светлая", dark: "Тёмная", auto: "Авто" };
  $("#themeLabel").textContent = labels[state.settings.theme_mode || "auto"] || "Авто";
  $("#themeIcon").innerHTML = icon("theme");
}
setInterval(() => { if (state.settings.theme_mode === 'auto') applyTheme(); }, 60000);
$("#themeToggle").addEventListener("click", () => {
  const cur = state.settings.theme_mode || "auto";
  const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
  state.settings.theme_mode = next;
  api.saveSettings({ theme_mode: next }).catch(() => {});
  applyTheme();
});

// === приветствие и профиль ===
function greetingText() {
  const h = new Date().getHours();
  const part = h < 6 ? "Доброй ночи" : h < 11 ? "Доброе утро" : h < 17 ? "Здравствуй" : h < 22 ? "Добрый вечер" : "Доброй ночи";
  const name = state.profile?.name?.trim();

  return name ? `${part}, ${name}` : part;
}
function avatarDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vovremya-avatar', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение');
  let bitmap;
  let imageUrl;
  if (typeof createImageBitmap === 'function') {
    try { bitmap = await createImageBitmap(file); } catch { /* Safari may need an Image element. */ }
  }
  if (!bitmap) {
    imageUrl = URL.createObjectURL(file);
    try {
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Не удалось открыть изображение'));
        image.src = imageUrl;
      });
    } finally { URL.revokeObjectURL(imageUrl); }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  const ratio = Math.max(512 / bitmap.width, 512 / bitmap.height);
  const width = bitmap.width * ratio, height = bitmap.height * ratio;
  context.drawImage(bitmap, (512 - width) / 2, (512 - height) / 2, width, height);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
  if (!blob) throw new Error('Не удалось сохранить фотографию');
  const database = await avatarDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('photos', 'readwrite');
    transaction.objectStore('photos').put(blob, 'profile');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function clearAvatar() {
  const database = await avatarDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('photos', 'readwrite');
    transaction.objectStore('photos').delete('profile');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function loadAvatar() {
  const database = await avatarDatabase();
  const blob = await new Promise((resolve, reject) => {
    const request = database.transaction('photos').objectStore('photos').get('profile');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  const avatar = $('#profileAvatar');
  if (blob) {
    const url = URL.createObjectURL(blob);
    avatar.replaceChildren();
    const image = document.createElement('img'); image.src = url; image.alt = '';
    image.onload = () => URL.revokeObjectURL(url);
    avatar.append(image);
  }
}
function applyProfile() {
  const p = state.profile || {};
  const name = p.name?.trim();
  $("#heroGreeting").textContent = greetingText();
  $("#profileName").textContent = name || "Гость";
  $("#profileAvatar").textContent = p.avatar_emoji || (name ? name[0].toUpperCase() : "В");
  loadAvatar().catch(() => {});
  $("#heroDate").textContent = fmt.dayMonth(new Date().toISOString(), state.settings.timezone);
}
$("#profilePill").addEventListener("click", () => {
  setTimeout(() => {
    if (!state.profile?.name?.trim()) {
      const input = $("#profileNameInput");
      if (input) { input.focus(); input.classList.add("pulse"); setTimeout(() => input.classList.remove("pulse"), 1200); }
    }
  }, 60);
});

// === рутинг ===
const routeStack = [];
let navigatingBack = false;
function showRoute(name) {
  const changed = name !== state.route;
  if (changed && !navigatingBack) routeStack.push(state.route);
  state.route = name;
  $('#navBack').classList.toggle('hidden', name === 'home');
  $$(".route").forEach(s => s.classList.toggle("hidden", s.dataset.view !== name));
  $$(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.route === name));
  if (name === "home") renderHome();
  if (name === "calendar") renderCalendar();
  if (name === "tasks") renderTasks();
  // маршрут "quick" больше не используется — быстрый ввод живёт инлайном на главной
  if (name === "settings") renderSettings();
  if (name === "profile") renderProfile();
  if (name === "overview") prepareOverview();
  if (changed) window.scrollTo(0, 0);
}
$('#navBack').addEventListener('click', () => {
  if (!$('#sidePanel').inert) { closeSidePanel(); return; }
  const target = routeStack.pop() || 'home';
  navigatingBack = true;
  location.hash = '#' + target;
  showRoute(target);
  navigatingBack = false;
  requestAnimationFrame(() => window.scrollTo(0, 0));
});

$("#navToggle").addEventListener("click", () => {
  $("#nav").classList.toggle("open");
});
const brandMenuToggle = $('#brandMenuToggle');
function setBrandMenu(open) {
  $('#nav').classList.toggle('menu-open', open);
  brandMenuToggle.setAttribute('aria-expanded', String(open));
  brandMenuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  brandMenuToggle.querySelector('.brand-menu-glyph').textContent = open ? '×' : '☰';
}
brandMenuToggle.addEventListener('click', () => {
  if (window.innerWidth > 720) return;
  setBrandMenu(!$('#nav').classList.contains('menu-open'));
});
$$(".nav-item").forEach(a => a.addEventListener("click", () => {
  $("#nav").classList.remove("open");
  setBrandMenu(false);
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    setBrandMenu(false);
  }
});

window.addEventListener("hashchange", () => {
  const r = (location.hash || "#home").slice(1);
  if (["home", "calendar", "tasks", "settings", "profile", "overview"].includes(r)) showRoute(r);
});
function refreshCurrent() {
  if (state.route === "home") renderHome();
  if (state.route === "calendar") renderCalendar();
  if (state.route === "tasks") renderTasks();
}

// === карточка задачи (компактная — для корзин и календаря) ===
function compactTaskCard(t) {
  const c = catInfo(t.category);
  const isOverdue = t.status !== "done" && t.status !== "cancelled" && new Date(t.start_at) < new Date();
  const wrap = document.createElement("div");
  wrap.className = "task-card" + (t.status === "done" ? " done" : "") + (isOverdue ? " overdue" : "");
  wrap.dataset.id = t.id;
  wrap.innerHTML = `
    <div class="cat-stripe" ></div>
    <div class="body">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="meta">
        <span class="tag">${categoryBadge(c.name)}${escapeHtml(c.name)}</span>
        <span class="meta-item">${icon("clock")} ${escapeHtml(fmt.dateTime(t.start_at, state.settings.timezone))}</span>
        <span class="prio-dot p${t.priority || 3}" title="${priorityLabel(t.priority)}"></span>
        ${(t.reminders && t.reminders.length) ? `<span class="meta-item">${icon("bell")} ${t.reminders.length}</span>` : ""}
        ${t.postponed_count ? `<span class="meta-item">${icon("repeat")} ${t.postponed_count}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="icon-btn act-done" title="${t.status === 'done' ? 'Вернуть в работу' : 'Завершить'}" aria-label="${t.status === 'done' ? 'Вернуть в работу' : 'Завершить'}" aria-pressed="${t.status === 'done'}">${icon('check')}</button>
      <button class="icon-btn act-edit" title="Редактировать" aria-label="Редактировать">${icon('edit')}</button>
      <button class="icon-btn act-delete" title="Удалить" aria-label="Удалить задачу">${icon('trash')}</button>
    </div>
  `;
  wrap.addEventListener("click", (e) => {
    if (e.target.closest('.act-delete')) {
      e.stopPropagation();
      deleteTask(t, e.target.closest('button'));
      return;
    }
    if (e.target.closest(".act-done")) {
      e.stopPropagation();
      finishTask(t, e.target.closest("button"));
      return;
    }
    if (e.target.closest(".act-edit")) { openSidePanel(t.id); return; }
    openSidePanel(t.id);
  });
  return wrap;
}

// === карточка для "Все задачи" — с крупными действиями ===
function bigTaskCard(t) {
  const c = catInfo(t.category);
  const isOverdue = t.status !== "done" && t.status !== "cancelled" && new Date(t.start_at) < new Date();
  const wrap = document.createElement("div");
  wrap.className = "task-card" + (t.status === "done" ? " done" : "") + (isOverdue ? " overdue" : "");
  wrap.dataset.id = t.id;
  wrap.innerHTML = `
    <div class="cat-stripe" ></div>
    <div class="body">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="meta">
        <span class="tag">${categoryBadge(c.name)}${escapeHtml(c.name)}</span>
        <span class="meta-item">${icon("clock")} ${escapeHtml(fmt.dateTime(t.start_at, state.settings.timezone))}</span>
        <span class="prio-dot p${t.priority || 3}" title="${priorityLabel(t.priority)}"></span>
            ${(t.reminders && t.reminders.length) ? `<span class="meta-item">${icon("bell")} ${t.reminders.map(reminderLabel).join(", ")}</span>` : ""}
        ${t.postponed_count ? `<span class="meta-item">${icon("repeat")} перенесена ${t.postponed_count}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="icon-btn act" data-act="edit" title="Редактировать" aria-label="Редактировать">${icon("edit")}</button>
      <button class="icon-btn act" data-act="postpone" title="Перенести" aria-label="Перенести">${icon("repeat")}</button>
      <button class="icon-btn act act-done" data-act="done" title="${t.status === 'done' ? 'Вернуть в работу' : 'Завершить'}" aria-label="${t.status === 'done' ? 'Вернуть в работу' : 'Завершить'}" aria-pressed="${t.status === 'done'}">${icon('check')}</button>
      <button class="icon-btn act danger" data-act="del" title="Удалить" aria-label="Удалить">${icon("trash")}</button>
    </div>
  `;
  wrap.addEventListener("click", (e) => {
    const a = e.target.closest(".act");
    if (!a) { openSidePanel(t.id); return; }
    e.stopPropagation();
    const act = a.dataset.act;
    if (act === "edit") openSidePanel(t.id);
    else if (act === "postpone") openPostponeMenu(t.id);
    else if (act === "done") {
      finishTask(t, a);
    } else if (act === "del") deleteTask(t, a);
  });
  return wrap;
}

// === Главная ===
function priorityGroup(task) { return Math.min(4, Number(task.priority) || 3); }
function renderTodayAgenda(tasks) {
  const agenda = $('#todayAgenda');
  const list = $('#todayAgendaList');
  list.replaceChildren();
  const ordered = [...tasks].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.title.localeCompare(b.title, 'ru'));
  agenda.classList.toggle('hidden', ordered.length === 0);
  $('#todayAgendaCount').textContent = ordered.length ? `Задач: ${ordered.length}` : '';
  const appendRows = rows => {
    for (const task of rows) {
      const row = document.createElement('li');
      row.className = 'today-agenda-row' + (task.status === 'done' ? ' done' : '');
      row.dataset.priority = String(priorityGroup(task));
      const main = document.createElement('button');
      main.type = 'button'; main.className = 'today-agenda-open';
      main.innerHTML = `<span class="agenda-time">${escapeHtml(fmt.time(task.start_at, state.settings.timezone))}</span><span class="agenda-info"><strong>${escapeHtml(task.title)}</strong><span class="agenda-meta"><span class="agenda-category">${categoryBadge(task.category)}${escapeHtml(task.category)}</span><span class="agenda-priority">${escapeHtml(priorityLabel(task.priority))}</span>${task.status === 'done' ? '<span class="agenda-status">Выполнено</span>' : ''}</span></span>`;
      main.onclick = () => openSidePanel(task.id);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'icon-btn agenda-delete';
      remove.setAttribute('aria-label', 'Удалить задачу ' + task.title);
      remove.title = 'Удалить'; remove.innerHTML = icon('trash');
      remove.onclick = () => deleteTask(task, remove);
      row.append(main, remove); list.append(row);
    }
  };
  appendRows(ordered.slice(0, 5));
  if (ordered.length > 5) {
    const item = document.createElement('li');
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'ghost agenda-more';
    more.textContent = `Показать ещё ${ordered.length - 5}`;
    more.onclick = () => { item.remove(); appendRows(ordered.slice(5)); };
    item.append(more); list.append(item);
  }
}
function renderHome() {
  applyProfile();
  Promise.all([api.listTasks(), api.categories()]).then(([tasks, categories]) => {
    state.categories = categories;
    const today = dateKey(new Date(), state.settings.timezone);
    const todayTasks = tasks.filter(t => dateKey(t.start_at, state.settings.timezone) === today && t.status !== 'cancelled');
    renderTodayAgenda(todayTasks);
    const stats = [
      { label: 'Сегодня', value: todayTasks.length, filter: 'today' },
      { label: 'Важные', value: tasks.filter(t => t.priority <= 2 && t.status !== 'done').length, filter: 'important' },
      { label: 'Просрочено', value: tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && Date.parse(t.start_at) < Date.now()).length, filter: 'overdue' },
      { label: 'Выполнено', value: todayTasks.filter(t => t.status === 'done').length, filter: 'done' },
    ];
    $('#heroSummary').replaceChildren(...stats.map(stat => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill' + (state.filter === stat.filter ? ' active' : '');
      button.innerHTML = '<strong>' + stat.value + '</strong> ' + stat.label;
      button.addEventListener('click', () => {
        state.filter = stat.filter;
        location.hash = '#tasks';
        showRoute('tasks');
        if (window.innerWidth <= 720) $('#taskList').scrollIntoView({ behavior: 'smooth' });
      });
      return button;
    }));
    const upcoming = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && Date.parse(t.start_at) >= Date.now())
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const next = $('#nextTask');
    next.replaceChildren();
    if (upcoming.length) {
      const task = upcoming[0];
      next.innerHTML = '<small>СЛЕДУЮЩАЯ ЗАДАЧА</small><div class="next-task-info"><strong></strong><span class="next-task-date"></span><p></p></div><div class="next-task-actions"><button type="button" class="ghost next-open">Открыть</button><button type="button" class="icon-btn act-done" aria-label="Выполнить задачу" title="Выполнить задачу">' + icon('check') + '</button><button type="button" class="icon-btn act-edit" aria-label="Редактировать задачу" title="Редактировать задачу">' + icon('edit') + '</button><button type="button" class="icon-btn act-delete" aria-label="Удалить задачу" title="Удалить задачу">' + icon('trash') + '</button></div>';
      next.querySelector('strong').textContent = task.title;
      next.querySelector('.next-task-date').textContent = fmt.dayMonth(task.start_at, state.settings.timezone) + ' ' + fmt.date(task.start_at, state.settings.timezone).slice(-4) + ' г. · ' + fmt.time(task.start_at, state.settings.timezone);
      next.querySelector('p').textContent = task.category + ' · ' + priorityLabel(task.priority);
      next.querySelector('.next-open').onclick = () => openSidePanel(task.id);
      next.querySelector('.act-done').onclick = () => finishTask(task, next.querySelector('.act-done'));
      next.querySelector('.act-edit').onclick = () => openSidePanel(task.id);
      next.querySelector('.act-delete').onclick = () => deleteTask(task, next.querySelector('.act-delete'));
    }
    const homeEmpty = $('#homeEmpty');
    const remaining = tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled');
    const completed = tasks.filter(task => task.status === 'done').sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
    homeEmpty.classList.toggle('hidden', remaining.length > 0);
    $('#buckets').classList.toggle('hidden', remaining.length === 0);
    $('#completedBucket').classList.toggle('hidden', completed.length === 0);
    $('#cntCompleted').textContent = completed.length;
    const completedList = $('#completedList');
    completedList.replaceChildren(...completed.slice(0, 4).map(compactTaskCard));
    if (completed.length > 4) {
      const more = document.createElement('button');
      more.className = 'ghost';
      more.textContent = 'Показать ещё ' + (completed.length - 4);
      more.onclick = () => more.replaceWith(...completed.slice(4).map(compactTaskCard));
      completedList.append(more);
    }
    $('#completedHeading').onclick = () => {
      state.filter = 'done'; state.priorityFilter = 0;
      location.hash = '#tasks'; showRoute('tasks');
    };
    if (!remaining.length) {
      homeEmpty.innerHTML = tasks.some(task => task.status === 'done')
        ? '<h3>На сегодня всё</h3><p>Можно спокойно завершать день.</p><button class="cta" type="button">Добавить задачу</button>'
        : '<h3>Сегодня ничего не запланировано</h3><button class="cta" type="button">Добавить задачу</button>';
      homeEmpty.querySelector('button').onclick = () => openSidePanel(null);
    }
    for (let group = 1; group <= 4; group++) {
      $('[data-priority="' + group + '"] .priority-heading').onclick = () => {
        state.filter = 'all'; state.priorityFilter = group;
        location.hash = '#tasks'; showRoute('tasks');
      };
      const active = tasks.filter(t => t.status !== 'cancelled' && priorityGroup(t) === group);
      const open = active.filter(t => t.status !== 'done');
      const list = $('[data-bucket="p' + group + '"]');
      list.replaceChildren(...open.slice(0, 4).map(compactTaskCard));
      $('#cntP' + group).textContent = open.length;
      if (open.length > 4) {
        const more = document.createElement('button');
        more.className = 'ghost';
        more.textContent = 'Показать ещё ' + (open.length - 4);
        more.onclick = () => more.replaceWith(...open.slice(4).map(compactTaskCard));
        list.append(more);
      }
    }
  }).catch(error => toast('Не удалось загрузить данные: ' + error.message, 'err'));
}

// === Календарь ===
async function renderCalendar() {
  $("#calTitle").textContent = "Календарь";
  $$(".cal-modes .chip").forEach(c => c.classList.toggle("active", c.dataset.mode === state.calMode));
  if (state.calMode === "week") return renderWeek();
  if (state.calMode === "month") return renderMonth();
  if (state.calMode === "day") return renderDay();
}
async function renderWeek() {
  const tz = state.settings.timezone;
  const data = await api.calendarWeek(state.calAnchor.toISOString(), tz);
  const cont = $("#calContainer");
  cont.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cal-grid-week";
  const dow = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const head = document.createElement("div");
  head.className = "cal-row";
  for (const d of dow) {
    const el = document.createElement("div");
    el.className = "cal-dow"; el.textContent = d; head.appendChild(el);
  }
  wrap.appendChild(head);
  const row = document.createElement("div");
  row.className = "cal-week";
  for (const day of data.days) {
    const cell = document.createElement("div");
    cell.className = "cal-day" + (day.is_today ? " today" : "");
    const num = new Date(day.date + "T00:00:00").getDate();
    const numEl = document.createElement("div");
    numEl.className = "num"; numEl.textContent = num;
    cell.appendChild(numEl);
    if (!day.tasks.length) {
      const e = document.createElement("div");
      e.className = "cal-day-empty"; e.textContent = "—";
      cell.appendChild(e);
    } else {
      for (const t of day.tasks) cell.appendChild(makeCalTask(t));
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'calendar-add'; add.textContent = '+';
    add.setAttribute('aria-label', 'Добавить задачу на ' + day.date);
    add.onclick = () => openSidePanel(null, fromLocalInput(day.date + 'T12:00'));
    cell.appendChild(add);
    row.appendChild(cell);
  }
  wrap.appendChild(row);
  cont.appendChild(wrap);
  $("#calTitle").textContent = "Неделя: " + fmt.date(data.days[0].date + "T00:00:00") + " — " + fmt.date(data.days[6].date + "T00:00:00");
}
async function renderMonth() {
  const tz = state.settings.timezone;
  const cur = state.calAnchor;
  const [y, m] = dateKey(cur, tz).split("-").map(Number);
  const data = await api.calendarMonth(y, m, tz);
  const cont = $("#calContainer");
  cont.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cal-grid-month";
  const dow = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const head = document.createElement("div");
  head.className = "cal-row";
  for (const d of dow) {
    const el = document.createElement("div");
    el.className = "cal-dow"; el.textContent = d; head.appendChild(el);
  }
  wrap.appendChild(head);
  const row = document.createElement("div");
  row.className = "cal-row";
  for (const cell of data.cells) {
    const el = document.createElement("div");
    el.className = "cal-cell" + (cell.is_today ? " today" : "") + (cell.in_current_month ? "" : " dim");
    el.addEventListener('click', event => {
      if (event.target.closest('button, .cal-task')) return;
      state.calAnchor = new Date(cell.date + 'T12:00:00');
      state.calMode = 'day'; renderCalendar();
    });
    const d = new Date(cell.date + "T00:00:00");
    const num = document.createElement("div");
    num.className = "num"; num.textContent = d.getDate(); el.appendChild(num);
    for (const t of cell.tasks.slice(0, 3)) el.appendChild(makeCalTask(t));
    if (cell.tasks.length > 3) {
      const more = document.createElement("div");
      more.className = "cal-task";
      more.style.borderLeftColor = "var(--text-mute)";
      more.textContent = `+${cell.tasks.length - 3} ещё`;
      el.appendChild(more);
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'calendar-add'; add.textContent = '+';
    add.setAttribute('aria-label', 'Добавить задачу на ' + cell.date);
    add.onclick = () => openSidePanel(null, fromLocalInput(cell.date + 'T12:00'));
    el.appendChild(add);
    row.appendChild(el);
  }
  wrap.appendChild(row);
  cont.appendChild(wrap);
  $("#calTitle").textContent = fmt.monthYear(y, m);
}
async function renderDay() {
  const tz = state.settings.timezone;
  const data = await api.calendarDay(state.calAnchor.toISOString(), tz);
  const cont = $("#calContainer");
  cont.innerHTML = "";
  const list = document.createElement("div");
  list.className = "task-list";
  if (!data.tasks.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.innerHTML = '<p>На этот день ничего не запланировано.</p><button class="cta" type="button">Добавить задачу</button>';
    e.querySelector('button').onclick = () => openSidePanel(null, fromLocalInput(data.date + 'T12:00'));
    list.appendChild(e);
  } else {
    for (const t of data.tasks) list.appendChild(bigTaskCard(t));
  }
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'cta'; add.textContent = 'Добавить задачу на ' + fmt.date(data.date + 'T00:00:00', tz);
  add.onclick = () => openSidePanel(null, fromLocalInput(data.date + 'T12:00'));
  const slots = document.createElement('div');
  slots.className = 'calendar-slots';
  for (let hour = 8; hour <= 20; hour++) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ghost';
    const time = String(hour).padStart(2, '0') + ':00';
    button.textContent = time + ' ＋';
    button.setAttribute('aria-label', 'Добавить задачу на ' + data.date + ' в ' + time);
    button.onclick = () => openSidePanel(null, fromLocalInput(data.date + 'T' + time));
    slots.append(button);
  }
  cont.append(add, list, slots);
  $("#calTitle").textContent = fmt.dayMonth(data.date + "T00:00:00", tz);
}
function makeCalTask(t) {
  const c = catInfo(t.category);
  const el = document.createElement("div");
  el.className = "cal-task" + (t.status === 'done' ? ' done' : '');
  el.style.borderLeftColor = c.color;
  el.innerHTML = `<button class="icon-btn act-done" aria-label="${t.status === 'done' ? 'Вернуть в работу' : 'Завершить'}" aria-pressed="${t.status === 'done'}">${icon('check')}</button><span class="cal-task-title">${escapeHtml(fmt.time(t.start_at, state.settings.timezone))} · ${escapeHtml(t.title)}</span><button class="icon-btn act-edit" aria-label="Редактировать">${icon('edit')}</button>`;
  el.addEventListener("click", e => {
    if (e.target.closest('.act-done')) { finishTask(t, e.target.closest('button')); return; }
    openSidePanel(t.id);
  });
  return el;
}
$$(".cal-modes .chip").forEach(c => c.addEventListener("click", () => { state.calMode = c.dataset.mode; renderCalendar(); }));
$("#calPrev").addEventListener("click", () => shiftCal(-1));
$("#calNext").addEventListener("click", () => shiftCal(1));
$("#calToday").addEventListener("click", () => { state.calAnchor = new Date(); renderCalendar(); });
function shiftCal(dir) {
  if (state.calMode === "week") state.calAnchor.setDate(state.calAnchor.getDate() + 7 * dir);
  else if (state.calMode === "month") state.calAnchor.setMonth(state.calAnchor.getMonth() + dir);
  else state.calAnchor.setDate(state.calAnchor.getDate() + dir);
  renderCalendar();
}

// === Все задачи ===
let taskRenderSequence = 0;
async function renderTasks() {
  const sequence = ++taskRenderSequence;
  const list = $("#taskList");
  let tasks = await api.listTasks(['important', 'overdue'].includes(state.filter) ? 'all' : state.filter, state.search);
  if (state.filter === 'important') tasks = tasks.filter(t => t.priority <= 2 && t.status !== 'done');
  if (state.filter === 'overdue') tasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && Date.parse(t.start_at) < Date.now());
  if (state.priorityFilter) tasks = tasks.filter(t => priorityGroup(t) === state.priorityFilter);
  if (state.categoryFilter) tasks = tasks.filter(t => t.category === state.categoryFilter);
  if (state.importanceFilter) tasks = tasks.filter(t => (t.priority <= 2) === (state.importanceFilter === 'yes'));
  if (state.urgencyFilter) tasks = tasks.filter(t => ([1, 3].includes(t.priority)) === (state.urgencyFilter === 'yes'));
  const categorySelect = $('#categoryFilter');
  const values = [...new Set([...state.categories.map(c => c.name), ...tasks.map(t => t.category)])];
  categorySelect.innerHTML = '<option value="">Все категории</option>' + values.map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('');
  categorySelect.value = state.categoryFilter;
  $('#importanceFilter').value = state.importanceFilter;
  $('#urgencyFilter').value = state.urgencyFilter;
  $('#taskFilterTitle').textContent = (state.categoryFilter || ({ important: 'Важные', overdue: 'Просрочено', today: 'Сегодня', done: 'Выполнено' }[state.filter] || 'Все категории')) + ' · ' + tasks.length + ' задач';
  if (sequence !== taskRenderSequence) return;
  state.tasks = tasks;
  list.innerHTML = "";
  if (!state.tasks.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.innerHTML = '<p>Здесь пока пусто.</p><button class="cta" type="button">Добавить задачу</button>';
    e.querySelector('button').onclick = () => openSidePanel(null);
    list.appendChild(e);
    return;
  }
  for (const t of state.tasks) list.appendChild(bigTaskCard(t));
}
for (const [id, key] of [['categoryFilter', 'categoryFilter'], ['importanceFilter', 'importanceFilter'], ['urgencyFilter', 'urgencyFilter']]) {
  $('#' + id).addEventListener('change', event => { state[key] = event.target.value; renderTasks(); });
}
$('#resetTaskFilters').addEventListener('click', () => {
  state.categoryFilter = state.importanceFilter = state.urgencyFilter = '';
  state.priorityFilter = 0;
  state.filter = 'all';
  renderTasks();
});
$("#filters").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  state.filter = c.dataset.filter;
  $$("#filters .chip").forEach(x => x.classList.toggle("active", x === c));
  renderTasks();
});
let searchDebounce;
$("#searchInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { state.search = e.target.value.trim(); renderTasks(); }, 200);
});

// === Быстрое добавление ===
async function quickPreviewFlow(text, container, onSave) {
  const tz = state.settings.timezone;
  const sequence = ++previewSequence;
  const data = await api.quickPreview(text, tz);
  if (sequence !== previewSequence) return;
  if (!data) { toast("Не удалось разобрать текст", "err"); return; }
  const cats = state.categories;
  container.classList.remove("hidden");
  container.innerHTML = `
    <h4>Проверь перед сохранением</h4>
    <div class="qp-row"><label>Название</label><input id="qpTitle" value="${escapeHtml(data.title)}"></div>
    <div class="qp-row"><label>Дата и время</label><input id="qpStart" type="datetime-local" value="${toLocalInput(data.start_at)}"></div>
    <div class="qp-row"><label>Категория</label><select id="qpCat">${cats.map(c => `<option value="${c.name}" ${c.name===data.category?'selected':''}>${c.emoji} ${c.name}</option>`).join("")}</select></div>
    <div class="qp-row"><label for="qpRem">Напоминание</label><select id="qpRem">
      <option value="" ${!data.reminders.length ? 'selected' : ''}>Без напоминания</option>
      ${REMINDER_OPTIONS.map(m => `<option value="${m}" ${data.reminders[0] === m ? 'selected' : ''}>${reminderLabel(m)}</option>`).join('')}
    </select><p class="hint" id="qpReminderTiming" role="status"></p></div>
    <div class="qp-actions">
      <button class="cta" id="qpSave">Сохранить</button>
      <button class="ghost" id="qpEdit">Изменить</button>
      <button class="ghost danger" id="qpCancel">Отменить</button>
      <span class="hint">Можно поправить любое поле</span>
    </div>
  `;
  $("#qpCancel").addEventListener("click", () => { container.classList.add("hidden"); container.innerHTML = ""; });
  $("#qpEdit").addEventListener("click", () => $("#qpTitle").focus());
  let selectedReminders = data.reminders;
  const updateQuickReminderHint = () => {
    $("#qpReminderTiming").textContent = reminderTimingHint($("#qpStart").value, selectedReminders);
  };
  $("#qpRem").addEventListener("change", e => { selectedReminders = e.target.value ? [Number(e.target.value)] : []; updateQuickReminderHint(); });
  $("#qpStart").addEventListener("change", updateQuickReminderHint);
  updateQuickReminderHint();
  $("#qpSave").addEventListener("click", async () => {
    const saveButton = $("#qpSave");
    if (saveButton.disabled) return;
    const payload = {
      title: $("#qpTitle").value.trim() || data.title,
      start_at: fromLocalInput($("#qpStart").value) || data.start_at,
      category: $("#qpCat").value,
      timezone: state.settings.timezone,
      reminders: selectedReminders,
      recurrence_rule: data.recurrence_rule,
    };
    try {
      saveButton.disabled = true;
      const created = await api.createTask(payload);
      toast("Задача добавлена", "ok");
      container.classList.add("hidden"); container.innerHTML = "";
      $("#quickInlineInput").value = "";
      refreshCurrent();
      if (onSave) onSave(created);
    } catch (e) { toast("Не удалось сохранить: " + e.message, "err"); }
    finally { saveButton.disabled = false; }
  });
}
$("#openQuick").addEventListener("click", () => openSidePanel(null));
let previewSequence = 0;
async function previewInline() {
  const text = $("#quickInlineInput").value.trim();
  if (!text) return;
  try { await quickPreviewFlow(text, $("#quickInlinePreview")); }
  catch (error) { toast(error.message, 'err'); }
}
$("#quickInlineInput").addEventListener("input", () => {
  // Не перестраиваем форму во время редактирования; предпросмотр по Enter/кнопке.
  $("#quickInlinePreview").classList.add("hidden");
  previewSequence++;
});
$("#quickInlineInput").addEventListener("keydown", e => { if (e.key === 'Enter') { e.preventDefault(); previewInline(); } });
$("#quickInlineBtn").addEventListener("click", previewInline);

// === Настройки ===
async function renderSettings() {
  const s = state.settings;
  const cats = state.categories;
  const g = $("#settingsGrid");
  g.innerHTML = "";
  const timezones = ["Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka"];
  g.innerHTML = `
    <div class="settings-card">
      <h3>Оформление</h3><p>Авто: светлая днём, вечерняя после 20:00.</p>
      <div class="field"><label>Тема</label>
        <div class="inline">
          ${["auto", "light", "dark"].map(m => `<button class="chip ${s.theme_mode===m?'active':''}" data-tm="${m}">${m==='auto'?'Авто':m==='light'?'Светлая':'Тёмная'}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="settings-card">
      <h3>Часовой пояс</h3>
      <div class="field"><label>Timezone</label>
        <select id="setTz">${timezones.map(t => `<option ${s.timezone===t?'selected':''}>${t}</option>`).join("")}</select>
      </div>
    </div>
    <div class="settings-card">
      <h3>Профиль</h3>
      <p class="hint" style="color:var(--text-mute);margin:0 0 12px">Имя используется для обращения на главной.</p>
      <button class="ghost" id="goProfile">Открыть профиль →</button>
    </div>
    <div class="settings-card">
      <h3>Напоминания</h3>
      <label class="switch-row"><input type="checkbox" id="remindersEnabled" ${s.reminders_enabled ? 'checked' : ''}> Уведомления браузера включены</label>
      <div class="field"><label for="defaultReminder">Напоминание по умолчанию</label><select id="defaultReminder">${REMINDER_OPTIONS.map(m => `<option value="${m}" ${s.default_reminders?.[0] === m ? 'selected' : ''}>${reminderLabel(m)}</option>`).join('')}</select></div>
      <p class="notification-status" id="notificationStatus">${notificationStatus()}</p>
      <p class="hint">Сейчас используются локальные браузерные уведомления. Они работают при разрешённых уведомлениях, пока вкладка или установленное PWA открыты и браузер позволяет выполнение. Сон устройства и ограничения браузера могут задержать уведомление. После закрытия приложения точное уведомление не гарантируется; при возвращении появятся «Пропущенные напоминания». Для уведомлений при закрытом приложении понадобится сервер или Telegram.</p>
    </div>
    <div class="settings-card">
      <h3>Хранение задач</h3>
      <p class="hint">${api.mode === 'cloud' ? 'Задачи сохраняются в облаке. При ошибке связи изменения не сохраняются. Профиль, тема и настройки браузерных уведомлений пока относятся к этому устройству.' : api.mode === 'local' ? 'Задачи сохранены в этом браузере. Они доступны без сервера, но не синхронизируются между устройствами. Очистка данных сайта удалит их.' : 'Задачи сохранены на сервере. Напоминания и разрешение на уведомления настраиваются отдельно в каждом браузере.'}</p>
      ${api.mode === 'local' ? `<details><summary>Расширенная настройка · для разработчика</summary><div class="field"><label for="cloudKey">Publishable key Supabase</label><input id="cloudKey" autocomplete="off" placeholder="sb_publishable_…"><p class="hint">Ключ можно найти в Supabase → Project Settings → API Keys. Он хранится только в этом браузере. После подключения войдите в созданный личный аккаунт.</p><button class="ghost" id="connectCloud">Подключить облако</button><p id="connectCloudStatus" role="status"></p></div></details>` : ''}
      ${api.mode === 'cloud' ? `<button class="ghost" id="cloudSignOut">Выйти из облачного аккаунта</button>` : ''}
    </div>
    ${api.mode === 'local' ? `
    <div class="settings-card">
      <h3>Резервная копия задач</h3>
      <p class="hint">Сохраните файл с задачами в личной папке. При восстановлении добавятся только задачи, которых ещё нет в списке.</p>
      <div class="inline">
        <button class="ghost" id="exportTasks">Скачать копию</button>
        <button class="ghost" id="chooseTaskBackup">Выбрать файл</button>
        <input type="file" id="taskBackupFile" accept=".json,application/json" hidden>
      </div>
      <p class="hint" id="taskBackupStatus" role="status"></p>
      <button class="ghost hidden" id="restoreTasks">Добавить задачи из копии</button>
    </div>` : ''}
    ${api.mode === 'cloud' ? `
    <div class="settings-card">
      <h3>Перенос и копия задач</h3>
      <p class="hint">Сначала скачайте копию задач этого браузера. Выберите файл для переноса в облако. Исходные задачи сохранятся.</p>
      <div class="inline">
        <button class="ghost" id="exportOldTasks">Скачать местные задачи</button>
        <button class="ghost" id="exportCloudTasks">Скачать облачные задачи</button>
        <button class="ghost" id="chooseCloudBackup">Выбрать файл для облака</button>
        <input type="file" id="cloudBackupFile" accept=".json,application/json" hidden>
      </div>
      <p id="cloudBackupStatus" role="status"></p>
      <button class="ghost hidden" id="importCloudTasks">Добавить задачи в облако</button>
    </div>` : ''}
    ${api.mode === 'cloud' ? `
    <div class="settings-card">
      <h3>Telegram</h3>
      <p class="hint">Бот отправляет сообщения по облачному расписанию после привязки. Сначала откройте ссылку и нажмите «Старт» в Telegram.</p>
      <p id="telegramStatus" role="status">Проверяем подключение…</p>
      <button class="ghost" id="telegramRefresh">Проверить привязку</button>
      <button class="ghost" id="telegramLink">Привязать Telegram</button>
      <a class="ghost hidden" id="telegramStart" target="_blank" rel="noopener">Открыть бота</a>
      <div class="field"><label for="telegramPrivacy">Текст сообщения</label>
        <select id="telegramPrivacy"><option value="neutral">Без названия задачи</option><option value="title">С названием задачи</option></select>
      </div>
      <button class="ghost" id="telegramUnlink">Отключить Telegram</button>
    </div>` : ''}
    <div class="settings-card">
      <h3>Категории</h3>
      <div class="inline">
        ${cats.map(c => `<span class="tag">${categoryBadge(c.name)}${escapeHtml(c.name)}</span>`).join("")}
      </div>
      <div class="field"><label for="newCategoryName">Новая категория</label><input id="newCategoryName" maxlength="20" placeholder="Название до 20 символов"></div>
      <div class="field"><label for="newCategoryIcon">Иконка</label><select id="newCategoryIcon"><option value="medical">Медицина</option><option value="family">Семья</option><option value="work">Работа</option><option value="home">Дом</option><option value="kids">Дети</option></select></div>
      <div class="field"><label for="newCategoryColor">Вспомогательный оттенок</label><input id="newCategoryColor" type="color" value="#8b77ad"></div>
      <button class="ghost" id="addCategory" type="button">Добавить категорию</button>
      <div id="categoryManage">${cats.map(c => `<div class="category-manage"><span>${escapeHtml(c.name)}</span><button type="button" data-category-up="${escapeHtml(c.name)}" aria-label="Поднять категорию ${escapeHtml(c.name)}">↑</button><button type="button" data-category-down="${escapeHtml(c.name)}" aria-label="Опустить категорию ${escapeHtml(c.name)}">↓</button><button type="button" data-category-rename="${escapeHtml(c.name)}">Переименовать</button><button type="button" data-category-archive="${escapeHtml(c.name)}">Архивировать</button></div>`).join('')}</div>
    </div>
  `;
  $('#addCategory', g).addEventListener('click', async () => {
    try {
      api.saveCategory({ name: $('#newCategoryName', g).value, icon: $('#newCategoryIcon', g).value, color: $('#newCategoryColor', g).value });
      state.categories = await api.categories();
      renderSettings();
    } catch (error) { toast(error.message, 'err'); }
  });
  for (const [attribute, direction] of [['data-category-up', -1], ['data-category-down', 1]]) {
    g.querySelectorAll('[' + attribute + ']').forEach(button => button.addEventListener('click', async () => {
      await api.moveCategory(button.getAttribute(attribute), direction);
      state.categories = await api.categories(); renderSettings();
    }));
  }
  g.querySelectorAll('[data-category-rename]').forEach(button => button.addEventListener('click', async () => {
    const current = button.dataset.categoryRename;
    const name = prompt('Новое название категории', current);
    if (!name || name === current) return;
    try { await api.renameCategory(current, name); state.categories = await api.categories(); renderSettings(); }
    catch (error) { toast(error.message, 'err'); }
  }));
  g.querySelectorAll('[data-category-archive]').forEach(button => button.addEventListener('click', async () => {
    api.saveCategory({ name: button.dataset.categoryArchive, archived: true });
    state.categories = await api.categories();
    renderSettings();
  }));
  g.querySelectorAll("[data-tm]").forEach(b => b.addEventListener("click", () => {
    state.settings.theme_mode = b.dataset.tm;
    api.saveSettings({ theme_mode: b.dataset.tm });
    applyTheme();
    renderSettings();
  }));
  $("#setTz").addEventListener("change", async e => { state.settings = await api.saveSettings({ timezone: e.target.value }); applyProfile(); });
  $("#remindersEnabled").addEventListener("change", async e => {
    try {
      if (e.target.checked) await enableReminders();
      else { state.settings = await api.saveSettings({ reminders_enabled: false }); await reminders.check(); }
      renderSettings();
    } catch (error) { e.target.checked = state.settings.reminders_enabled; toast(error.message, 'err'); }
  });
  $("#defaultReminder").addEventListener("change", async e => {
    state.settings = await api.saveSettings({ default_reminders: [Number(e.target.value)] });
  });
  if (api.mode === 'local') bindTaskBackup(g);
  if (api.mode === 'local') {
    $("#connectCloud", g).addEventListener('click', () => {
      try { api.configureCloud($("#cloudKey", g).value.trim()); }
      catch (error) { $("#connectCloudStatus", g).textContent = error.message; }
    });
  }
  if (api.mode === 'cloud') { bindCloudBackup(g); bindTelegram(g); }
  $("#goProfile").addEventListener("click", () => { location.hash = '#profile'; });
}

function bindTelegram(grid) {
  const status = $("#telegramStatus", grid);
  const privacy = $("#telegramPrivacy", grid);
  const start = $("#telegramStart", grid);
  privacy.disabled = true;
  async function updateStatus() {
    try {
      const data = await api.telegramStatus();
      status.textContent = data.linked ? 'Telegram привязан.' : 'Telegram ещё не привязан.';
      privacy.value = data.privacy;
      privacy.disabled = !data.linked;
    } catch (error) { status.textContent = error.message; }
  }
  $("#telegramLink", grid).addEventListener('click', async () => {
    status.textContent = 'Создаём ссылку…';
    try {
      const data = await api.telegramLink();
      const url = new URL(data.url);
      if (url.origin !== 'https://t.me') throw new Error('Неверная ссылка Telegram');
      start.href = url.href;
      start.classList.remove('hidden');
      status.textContent = 'Ссылка действует 10 минут. Откройте бота и нажмите «Старт».';
    } catch (error) { status.textContent = error.message; }
  });
  privacy.addEventListener('change', async () => {
    try { await api.telegramPrivacy(privacy.value); status.textContent = 'Настройка сохранена.'; }
    catch (error) { status.textContent = error.message; }
  });
  $("#telegramUnlink", grid).addEventListener('click', async () => {
    try { await api.telegramUnlink(); start.classList.add('hidden'); await updateStatus(); }
    catch (error) { status.textContent = error.message; }
  });
  $("#telegramRefresh", grid).addEventListener('click', updateStatus);
  updateStatus();
}

function downloadBackup(contents, prefix) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = prefix + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function bindCloudBackup(grid) {
  const status = $("#cloudBackupStatus", grid);
  const input = $("#cloudBackupFile", grid);
  const button = $("#importCloudTasks", grid);
  let pending = null;
  $("#cloudSignOut", grid).addEventListener('click', async () => {
    try { await api.signOut(); location.reload(); }
    catch (error) { status.textContent = error.message; }
  });
  $("#exportOldTasks", grid).addEventListener('click', () => {
    try { downloadBackup(api.exportLocalTasks(), 'vovremya-local-tasks'); }
    catch (error) { status.textContent = error.message; }
  });
  $("#exportCloudTasks", grid).addEventListener('click', async () => {
    try { downloadBackup(await api.exportCloudTasks(), 'vovremya-cloud-tasks'); }
    catch (error) { status.textContent = error.message; }
  });
  $("#chooseCloudBackup", grid).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    pending = null;
    button.classList.add('hidden');
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    status.textContent = 'Проверяем файл и облачные задачи…';
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Размер файла превышает 20 МБ');
      const raw = await file.text();
      const preview = await api.previewCloudImport(raw);
      status.textContent = 'К добавлению: ' + preview.added + '. Уже в облаке: ' + preview.skipped + '.';
      if (preview.added) { pending = raw; button.classList.remove('hidden'); }
    } catch (error) { status.textContent = error.message; }
  });
  button.addEventListener('click', async () => {
    if (!pending) return;
    button.disabled = true;
    try {
      const result = await api.importCloudTasks(pending);
      pending = null;
      button.classList.add('hidden');
      status.textContent = 'Добавлено: ' + result.added + '. Уже в облаке: ' + result.skipped + '.';
      refreshCurrent();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function bindTaskBackup(grid) {
  const input = $("#taskBackupFile", grid);
  const status = $("#taskBackupStatus", grid);
  const restore = $("#restoreTasks", grid);
  let pending = null;
  let selection = 0;
  const describe = ({ added, skipped }) => `К добавлению: ${added}. Уже в списке: ${skipped}.`;

  $("#exportTasks", grid).addEventListener('click', () => {
    try {
      const url = URL.createObjectURL(new Blob([api.exportLocalTasks()], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `vovremya-tasks-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { status.textContent = error.message; }
  });
  $("#chooseTaskBackup", grid).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    const current = ++selection;
    pending = null;
    restore.classList.add('hidden');
    if (!file) return;
    status.textContent = 'Проверяем файл…';
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Размер файла превышает 20 МБ');
      const raw = await file.text();
      if (current !== selection) return;
      const preview = api.previewLocalRestore(raw);
      status.textContent = describe(preview);
      if (preview.added) {
        pending = raw;
        restore.classList.remove('hidden');
      }
    } catch (error) {
      if (current === selection) status.textContent = error.message;
    }
  });
  restore.addEventListener('click', () => {
    if (pending === null) return;
    try {
      const result = api.restoreLocalTasks(pending);
      pending = null;
      restore.classList.add('hidden');
      status.textContent = `Добавлено: ${result.added}. Уже было в списке: ${result.skipped}.`;
    } catch (error) { status.textContent = error.message; }
  });
}

// === Профиль ===
function renderProfile() {
  const p = state.profile;
  const g = $("#profileGrid");
  if (!g) return;
  let selectedEmoji = p.avatar_emoji || '';
  let avatarChoice = 'existing';
  g.innerHTML = `
    <div class="profile-card">
      <h3>Имя и аватар</h3>
      <div class="field"><label>Имя</label><input id="profileNameInput" value="${escapeHtml(p.name || '')}" placeholder="Как тебя зовут?"></div>
      <div class="field"><label>Чем занимаешься</label><input id="profileOcc" value="${escapeHtml(p.occupation || '')}" placeholder="Например: предприниматель"></div>
      <div class="field"><span>Фотография профиля</span><input id="avatarPhoto" class="file-input" type="file" accept="image/*"><label class="ghost file-picker" for="avatarPhoto">Выбрать фото</label><p class="hint" id="avatarPhotoStatus" role="status">После выбора фотография сохранится на этом устройстве.</p></div>
      <div class="field"><label>Символ профиля</label>
        <div class="profile-emoji-row" id="emojiRow">
          ${["🌿","🌸","☕","📓","✦","🪴","🌤","🌙"].map(e => `<button type="button" class="chip ${p.avatar_emoji===e?'active':''}" data-em="${e}" aria-label="Выбрать символ ${e}">${e}</button>`).join("")}
        </div>
      </div>
      <button class="cta" id="profileSave">Сохранить</button>
    </div>
    <div class="profile-card">
      <h3>Часовой пояс и тема</h3>
      <div class="field"><label>Timezone</label>
        <select id="profileTz">${["Europe/Moscow","Europe/Kaliningrad","Europe/Samara","Asia/Yekaterinburg","Asia/Novosibirsk","Asia/Krasnoyarsk","Asia/Irkutsk","Asia/Yakutsk","Asia/Vladivostok","Asia/Magadan","Asia/Kamchatka"].map(t => `<option ${state.settings.timezone===t?'selected':''}>${t}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Тема</label>
        <div class="inline">
          ${["auto","light","dark"].map(m => `<button class="chip ${state.settings.theme_mode===m?'active':''}" data-ptm="${m}">${m==='auto'?'Авто':m==='light'?'Светлая':'Тёмная'}</button>`).join("")}
        </div>
      </div>
    </div>
  `;
  $('#avatarPhoto').addEventListener('change', async event => {
    if (!event.target.files[0]) return;
    const status = $('#avatarPhotoStatus');
    status.textContent = 'Сохраняем фото…';
    try { await saveAvatar(event.target.files[0]); avatarChoice = 'photo'; await loadAvatar(); status.textContent = 'Фото сохранено. Оно появится в шапке приложения.'; toast('Фото профиля сохранено'); }
    catch (error) { status.textContent = error.message; toast(error.message, 'err'); }
  });
  $$(".profile-emoji-row .chip").forEach(b => b.addEventListener("click", () => {
    $$(".profile-emoji-row .chip").forEach(x => x.classList.toggle("active", x === b));
    selectedEmoji = b.dataset.em;
    avatarChoice = 'symbol';
    $("#profileAvatar").textContent = b.dataset.em;
    $('#avatarPhotoStatus').textContent = 'Символ появится после сохранения профиля.';
  }));
  g.querySelectorAll("[data-ptm]").forEach(b => b.addEventListener("click", () => {
    state.settings.theme_mode = b.dataset.ptm;
    api.saveSettings({ theme_mode: b.dataset.ptm });
    applyTheme();
    renderProfile();
  }));
  $("#profileTz").addEventListener("change", async e => { state.settings = await api.saveSettings({ timezone: e.target.value }); applyProfile(); });
  $("#profileSave").addEventListener("click", async () => {
    const name = $("#profileNameInput").value.trim();
    const occ = $("#profileOcc").value.trim();
    if (avatarChoice === 'symbol') await clearAvatar();
    const updated = await api.saveProfile({ name: name || null, occupation: occ || null, avatar_emoji: selectedEmoji || null });
    state.profile = updated;
    applyProfile();
    toast("Профиль сохранён", "ok");
  });
}

// Обзор дня формируется из того же источника, что и остальные экраны.
let overviewTasks = [];
let overviewRequest = 0;
function overviewText() {
  const day = $('#overviewDate').value;
  return ['Вовремя · ' + day, ...overviewTasks.map(task =>
    `${fmt.time(task.start_at, state.settings.timezone)} · ${task.title} · ${task.category} · ${priorityLabel(task.priority)} · ${task.status === 'done' ? 'Выполнено' : 'Осталось'}`)].join('\n');
}
function prepareOverview() {
  const date = $('#overviewDate');
  if (!date.value) date.value = dateKey(new Date(), state.settings.timezone);
  overviewTasks = [];
  $('#overviewContent').replaceChildren();
  $('#overviewStatus').textContent = 'Выберите дату и порядок, затем нажмите «Сформировать отчёт».';
  $('.overview-actions').classList.add('hidden');
  $('#overviewShareHint').classList.add('hidden');
}
async function renderOverview() {
  const date = $('#overviewDate');
  if (!date.value) date.value = dateKey(new Date(), state.settings.timezone);
  const selectedDate = date.value;
  const selectedOrder = $('#overviewOrder').value;
  const request = ++overviewRequest;
  $('#overviewStatus').textContent = 'Формируем отчёт…';
  $('.overview-actions').classList.add('hidden');
  let all;
  try { all = await api.listTasks(); }
  catch (error) { $('#overviewStatus').textContent = 'Не удалось сформировать отчёт: ' + error.message; return; }
  if (request !== overviewRequest || selectedDate !== date.value || selectedOrder !== $('#overviewOrder').value) return;
  overviewTasks = all.filter(task => dateKey(task.start_at, state.settings.timezone) === selectedDate && task.status !== 'cancelled');
  if ($('#overviewOrder').value === 'priority') overviewTasks.sort((a, b) => priorityGroup(a) - priorityGroup(b) || Date.parse(a.start_at) - Date.parse(b.start_at));
  else overviewTasks.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const done = overviewTasks.filter(task => task.status === 'done').length;
  const overdue = overviewTasks.filter(task => task.status !== 'done' && Date.parse(task.start_at) < Date.now()).length;
  const content = $('#overviewContent');
  content.innerHTML = `<div class="overview-summary">Всего ${overviewTasks.length} · Выполнено ${done} · Осталось ${overviewTasks.length - done} · Просрочено ${overdue}</div>`;
  const next = overviewTasks.find(task => task.status !== 'done' && Date.parse(task.start_at) >= Date.now());
  if (next) { const line = document.createElement('p'); line.textContent = 'Следующая задача · ' + next.title; content.append(line); }
  for (const task of overviewTasks) {
    const row = document.createElement('div'); row.className = 'overview-row';
    row.textContent = fmt.time(task.start_at, state.settings.timezone) + ' · ' + task.title + ' · ' + task.category + ' · ' + priorityLabel(task.priority) + ' · ' + (task.status === 'done' ? 'Выполнено' : 'Осталось');
    content.append(row);
  }
  if (!overviewTasks.length) content.insertAdjacentHTML('beforeend', '<p>На этот день ничего не запланировано.</p>');
  $('#overviewStatus').textContent = 'Отчёт за ' + fmt.date(selectedDate + 'T12:00:00', state.settings.timezone) + ' сформирован. Задач: ' + overviewTasks.length + '.';
  $('.overview-actions').classList.remove('hidden');
  $('#overviewShareHint').classList.remove('hidden');
}
$('#makeOverview').onclick = renderOverview;
for (const id of ['overviewDate', 'overviewOrder']) {
  $('#' + id).addEventListener('change', () => {
    overviewRequest++;
    overviewTasks = [];
    $('#overviewContent').replaceChildren();
    $('#overviewStatus').textContent = 'Параметры изменены. Сформируйте отчёт снова.';
    $('.overview-actions').classList.add('hidden');
    $('#overviewShareHint').classList.add('hidden');
  });
}
$('#overviewPrint').onclick = () => window.print();
$('#overviewCopy').onclick = async () => { await navigator.clipboard.writeText(overviewText()); toast('Список скопирован'); };
$('#overviewShare').onclick = async () => {
  try {
    if (navigator.share) await navigator.share({ title: 'Обзор дня · Вовремя', text: overviewText() });
    else { await navigator.clipboard.writeText(overviewText()); toast('Список скопирован. Вставьте его в Telegram или другое приложение.'); }
  } catch (error) {
    if (error.name !== 'AbortError') toast('Не удалось поделиться: ' + error.message, 'err');
  }
};
$('#overviewPng').onclick = () => {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '25px sans-serif';
  const wrapped = overviewText().split('\n').flatMap(line => {
    const words = line.split(' '), rows = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (measure.measureText(candidate).width > 1120 && current) { rows.push(current); current = word; }
      else current = candidate;
    }
    rows.push(current);
    return rows;
  });
  for (let page = 0; page * 25 < wrapped.length; page++) {
    const part = wrapped.slice(page * 25, (page + 1) * 25);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 110 + part.length * 44;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f4f0fa'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#23113b'; context.font = '25px sans-serif';
    part.forEach((line, index) => context.fillText(line, 40, 65 + index * 44));
    const link = document.createElement('a'); link.download = 'vovremya-' + $('#overviewDate').value + '-' + (page + 1) + '.png'; link.href = canvas.toDataURL('image/png'); link.click();
  }
};

// === Боковая панель ===
let sideFocusReturn = null;
function openSidePanel(id, initialStart = null) {
  sideFocusReturn = document.activeElement;
  const taskPromise = id === null ? Promise.resolve({ title: '', description: '', start_at: initialStart || new Date((Math.floor(Date.now() / 60000) + 31) * 60000).toISOString(), category: 'Другое', priority: 3, reminders: state.settings.default_reminders || [60], status: 'planned' }) : api.getTask(id);
  taskPromise.then(t => {
    if (!t) return;
    state.editingId = id;
    $("#sideTitle").textContent = id === null ? "Новая задача" : "Редактировать задачу";
    $("#sideDelete").classList.toggle("hidden", id === null);
    const cats = state.categories.some(category => category.name === t.category) ? state.categories : [...state.categories, { name: t.category, emoji: '' }];
    $("#sideForm").innerHTML = `
      <div class="sp-field"><label for="spTitle">Название</label><input id="spTitle" value="${escapeHtml(t.title)}"></div>
      <details class="sp-field"><summary>Дополнительно</summary><label for="spDesc">Описание</label><textarea id="spDesc" rows="3" placeholder="Заметки, детали">${escapeHtml(t.description || '')}</textarea></details>
      <div class="sp-field"><label for="spStart">Дата и время</label><input id="spStart" type="datetime-local" value="${toLocalInput(t.start_at)}">${id === null ? '<p class="hint">Указано ближайшее время. Выберите, когда начнётся дело.</p>' : ''}</div>
      <div class="sp-field"><span class="sp-label">Категория</span>
        <div class="category-choice-grid" id="spCategoryChoices" role="group" aria-label="Выбрать категорию">
          ${cats.map(c => `<button type="button" class="category-choice ${c.name===t.category?'active':''}" data-category="${escapeHtml(c.name)}" aria-pressed="${c.name===t.category}">${categoryBadge(c.name)}<span>${escapeHtml(c.name)}</span></button>`).join('')}
        </div>
        <label for="spCat">Категория из списка</label><select id="spCat">${cats.map(c => `<option value="${escapeHtml(c.name)}" ${c.name===t.category?'selected':''}>${escapeHtml(c.name)}</option>`).join("")}</select></div>
      <div class="sp-field"><label>Приоритет</label>
        <div class="sp-actions-row" id="spPrio">
          ${[1,2,3,4].map(p => `<button type="button" class="chip ${priorityGroup(t)===p?'active':''}" data-p="${p}" aria-pressed="${priorityGroup(t)===p}"><span class="prio-dot p${p}"></span> ${priorityLabel(p)}</button>`).join("")}
        </div>
      </div>
      <div class="sp-field"><label>Напоминание</label>
        <div class="sp-actions-row" id="spRem">
          <button type="button" class="chip ${!t.reminders?.length?'active':''}" data-r="" aria-pressed="${!t.reminders?.length}">Без</button>
          ${REMINDER_OPTIONS.map(m => `<button type="button" class="chip ${t.reminders?.includes(m)?'active':''}" data-r="${m}" aria-pressed="${Boolean(t.reminders?.includes(m))}">${reminderLabel(m)}</button>`).join('')}
        </div>
        <p class="hint" id="spReminderTiming" role="status"></p>
      </div>
      <div class="sp-field ${id === null ? 'hidden' : ''}"><label>Действия</label>
        <div class="sp-actions-row">
          <button class="ghost" id="spPostpone">↻ Перенести</button>
          <button class="ghost ${t.status==='done'?'success':''}" id="spDone">${t.status==='done'?'↺ Вернуть':'✓ Завершить'}</button>
        </div>
      </div>
    `;
    let prio = t.priority;
    const updateCategoryChoices = () => {
      $$('#spCategoryChoices .category-choice').forEach(button => {
        const active = button.dataset.category === $('#spCat').value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };
    $$('#spCategoryChoices .category-choice').forEach(button => button.addEventListener('click', () => {
      $('#spCat').value = button.dataset.category;
      updateCategoryChoices();
    }));
    $('#spCat').addEventListener('change', updateCategoryChoices);
    $$("#spPrio .chip").forEach(b => b.addEventListener("click", () => {
      prio = Number(b.dataset.p);
      $$("#spPrio .chip").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute('aria-pressed', String(x === b)); });
    }));
    let selectedReminders = [...(t.reminders || [])];
    const updateSideReminderHint = () => {
      $("#spReminderTiming").textContent = reminderTimingHint($("#spStart").value, selectedReminders);
    };
    $$("#spRem .chip").forEach(b => b.addEventListener("click", () => {
      const minutes = Number(b.dataset.r);
      selectedReminders = minutes ? [minutes] : [];
      $$("#spRem .chip").forEach(x => { const active = x.dataset.r ? selectedReminders.includes(Number(x.dataset.r)) : !selectedReminders.length; x.classList.toggle("active", active); x.setAttribute('aria-pressed', String(active)); });
      updateSideReminderHint();
    }));
    $("#spStart").addEventListener("change", updateSideReminderHint);
    $("#spPostpone").addEventListener("click", () => openPostponeMenu(id));
    $("#spDone").addEventListener("click", () => {
      if (t.status === "done") api.reopenTask(id).then(() => { closeSidePanel(); refreshCurrent(); });
      else api.completeTask(id).then(() => { closeSidePanel(); refreshCurrent(); });
    });
    $("#sideOverlay").classList.add("open");
    $("#sidePanel").classList.add("open");
    $("#sidePanel").setAttribute("aria-hidden", "false");
    $("#sidePanel").inert = false;
    document.body.classList.add('panel-open');
    (window.innerWidth <= 720 ? $('#sideTitle') : $('#spTitle')).focus({ preventScroll: true });
    $("#sideSave").onclick = async () => {
      const payload = {
        title: $("#spTitle").value.trim(),
        description: $("#spDesc").value,
        start_at: fromLocalInput($("#spStart").value) || t.start_at,
        category: $("#spCat").value,
        priority: prio,
        timezone: state.settings.timezone,
        reminders: selectedReminders,
      };
      try {
        $("#sideSave").disabled = true;
        if (id === null) await api.createTask(payload);
        else await api.updateTask(id, payload);
        toast(id === null ? "Задача добавлена" : "Сохранено", "ok");
        closeSidePanel();
        refreshCurrent();
      } catch (error) { toast(error.message, 'err'); }
      finally { $("#sideSave").disabled = false; }
    };
    $("#sideDelete").onclick = () => {
      if (confirm("Удалить задачу?")) { api.deleteTask(id).then(() => { closeSidePanel(); refreshCurrent(); }); }
    };
  }).catch(error => toast(error.message, 'err'));
}
function closeSidePanel() {
  $("#sideOverlay").classList.remove("open");
  $("#sidePanel").classList.remove("open");
  $("#sidePanel").setAttribute("aria-hidden", "true");
  $("#sidePanel").inert = true;
  document.body.classList.remove('panel-open');
  if (sideFocusReturn?.isConnected) sideFocusReturn.focus();
  state.editingId = null;
}
$("#sideClose").addEventListener("click", closeSidePanel);
$("#sideCancel").addEventListener("click", closeSidePanel);
$("#sideOverlay").addEventListener("click", closeSidePanel);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#sidePanel").inert) closeSidePanel(); });

// === Меню «Перенести» ===
function openPostponeMenu(id) {
  const cur = $("#sidePanel").classList.contains("open");
  if (!cur) openSidePanel(id);
  setTimeout(() => {
    const form = $("#sideForm");
    const block = document.createElement("div");
    block.className = "sp-field";
    block.innerHTML = `<label>Перенести на</label>
      <div class="sp-actions-row">
        <button class="chip" data-pm="hour" data-ph="1">+1 час</button>
        <button class="chip" data-pm="hour" data-ph="3">+3 часа</button>
        <button class="chip" data-pm="evening">Вечером</button>
        <button class="chip" data-pm="tomorrow">Завтра</button>
        <button class="chip" data-pm="weekend">На выходные</button>
      </div>
      <div class="sp-actions-row" style="margin-top:6px">
        <input type="datetime-local" id="pmDate">
        <button class="ghost" id="pmApply">На дату</button>
      </div>`;
    form.appendChild(block);
    block.querySelectorAll(".chip[data-pm]").forEach(b => b.addEventListener("click", () => doPostpone(id, { mode: b.dataset.pm, hours: b.dataset.ph ? Number(b.dataset.ph) : undefined })));
    $("#pmApply").addEventListener("click", () => {
      const v = $("#pmDate").value;
      if (!v) return;
      doPostpone(id, { mode: "date", new_start: fromLocalInput(v) });
    });
  }, 50);
}
function doPostpone(id, opts) {
  api.postpone(id, opts).then(() => { closeSidePanel(); refreshCurrent(); toast("Перенесено", "ok"); });
}

// === Старт ===
async function boot() {
  try {
    await api.init();
    $("#cloudGate").classList.add('hidden');
    const [cats, settings, profile] = await Promise.all([api.categories(), api.getSettings(), api.getProfile()]);
    state.categories = cats;
    state.settings = { ...state.settings, ...settings };
    state.profile = profile;
    applyTheme();
    applyProfile();
    fillIcons();
    registerWorker();
    reminders.start(error => console.warn('Напоминания:', error.message));
    const r = (location.hash || "#home").slice(1);
    showRoute(["home", "calendar", "tasks", "settings", "profile", "overview"].includes(r) ? r : "home");
  } catch (e) {
    console.error(e);
    if (api.cloudConfigured) {
      $("#cloudGate").classList.remove('hidden');
      $("#cloudLoginStatus").textContent = e.code === 'AUTH_REQUIRED' ? '' : e.message;
    } else toast("Ошибка загрузки: " + e.message, "err");
  }
}
$("#cloudLogin").addEventListener('submit', async event => {
  event.preventDefault();
  const status = $("#cloudLoginStatus");
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  status.textContent = 'Проверяем вход…';
  try {
    await api.signIn($("#cloudEmail").value.trim(), $("#cloudPassword").value);
    $("#cloudPassword").value = '';
    await boot();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
$("#cloudChangeKey").addEventListener('click', () => {
  if (confirm('Отключить облако в этом браузере и открыть местные задачи? Облачные задачи останутся в аккаунте.'))
    api.disconnectCloud();
});
let workerRegistration = null;
async function registerWorker() {
  if ('serviceWorker' in navigator && isSecureContext) {
    try {
      workerRegistration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url));
      await navigator.serviceWorker.ready;
    } catch (error) { console.warn('PWA:', error.message); }
  }
}
const reminders = new ReminderManager({
  api,
  notify: entry => showBrowserNotification(entry, workerRegistration?.active ? workerRegistration : null, iso => fmt.dateTime(iso, state.settings.timezone)),
  onChange(entries, settings) {
    state.settings = { ...state.settings, ...settings };
    $("#reminderBanner").classList.toggle('hidden', settings.reminders_enabled);
    $("#missedReminders").classList.toggle('hidden', !entries.length);
    $("#missedList").innerHTML = entries.sort((a, b) => b.due - a.due).map(entry => `<li><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(fmt.dateTime(entry.start, settings.timezone))}</span></li>`).join('');
    if (state.route === 'settings') {
      const status = $("#notificationStatus");
      if (status) status.textContent = notificationStatus();
    }
  },
});
async function enableReminders() {
  const granted = await requestNotificationPermission();
  if (!granted) { toast(notificationStatus(), 'err'); return; }
  state.settings = await api.saveSettings({ reminders_enabled: true });
  await reminders.check();
  toast('Напоминания включены');
}
$("#enableReminders").addEventListener('click', () => enableReminders().catch(error => toast(error.message, 'err')));
$("#dismissMissed").addEventListener('click', () => reminders.dismiss().catch(error => toast(error.message, 'err')));
async function finishTask(task, button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (task.status === 'done') await api.reopenTask(task.id);
    else await api.completeTask(task.id);
    toast(task.status === 'done' ? 'Возвращено в работу' : 'Завершено');
    refreshCurrent();
  } catch (error) { button.disabled = false; toast(error.message, 'err'); }
}
async function deleteTask(task, button) {
  if (!confirm(`Удалить задачу «${task.title}»?`)) return;
  button.disabled = true;
  try {
    await api.deleteTask(task.id);
    toast('Задача удалена');
    refreshCurrent();
  } catch (error) { button.disabled = false; toast(error.message, 'err'); }
}
window.addEventListener('storage', event => {
  if (api.mode === 'cloud' && event.key === 'vovremya.cloud.session.v1') {
    location.reload();
    return;
  }
  if (api.mode) refreshCurrent();
});
window.addEventListener('focus', () => { if (api.mode === 'cloud') refreshCurrent(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && api.mode === 'cloud') refreshCurrent();
});
window.addEventListener('unhandledrejection', e => { toast(e.reason?.message || 'Не удалось выполнить действие', 'err'); });
boot();
