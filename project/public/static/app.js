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
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v).toISOString();
}
function priorityLabel(p) {
  return ["Срочно", "Важно", "Обычно", "Не срочно", "Когда-нибудь"][(p || 3) - 1] || "Обычно";
}
function reminderLabel(min) {
  if (min < 60) return `за ${min} мин`;
  if (min === 60) return "за 1 час";
  if (min === 90) return "за 1,5 часа";
  if (min === 120) return "за 2 часа";
  if (min % 60 === 0) return `за ${min / 60} ч`;
  return `за ${min} мин`;
}

// === API ===
const api = {
  base: "",
  async req(path, opts = {}) {
    const init = { method: opts.method || "GET", headers: { "content-type": "application/json" } };
    if (opts.body) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    const r = await fetch(this.base + path, init);
    if (r.status === 204) return null;
    const text = await r.text();
    try { return JSON.parse(text); } catch { return text; }
  },
  health: () => api.req("/api/health"),
  home: () => api.req("/api/home"),
  categories: () => api.req("/api/categories"),
  listTasks: (filter, q) => {
    const params = [];
    if (filter) params.push("filter=" + filter);
    if (q) params.push("q=" + encodeURIComponent(q));
    return api.req("/api/tasks" + (params.length ? "?" + params.join("&") : ""));
  },
  getTask: (id) => api.req("/api/tasks/" + id),
  createTask: (b) => api.req("/api/tasks", { method: "POST", body: b }),
  updateTask: (id, b) => api.req("/api/tasks/" + id, { method: "PATCH", body: b }),
  deleteTask: (id) => api.req("/api/tasks/" + id, { method: "DELETE" }),
  completeTask: (id) => api.req("/api/tasks/" + id + "/done", { method: "POST" }),
  cancelTask: (id) => api.req("/api/tasks/" + id + "/cancel", { method: "POST" }),
  reopenTask: (id) => api.req("/api/tasks/" + id + "/reopen", { method: "POST" }),
  postpone: (id, b) => api.req("/api/tasks/" + id + "/postpone", { method: "POST", body: b }),
  quickAdd: (text, tz) => api.req("/api/quick-add", { method: "POST", body: { text, timezone: tz } }),
  quickPreview: (text, tz) => api.req("/api/quick-preview", { method: "POST", body: { text, timezone: tz } }),
  calendarWeek: (anchor, tz) => api.req("/api/calendar/week?anchor=" + encodeURIComponent(anchor) + "&tz=" + tz),
  calendarMonth: (y, m, tz) => api.req("/api/calendar/month?year=" + y + "&month=" + m + "&tz=" + tz),
  calendarDay: (anchor, tz) => api.req("/api/calendar/day?anchor=" + encodeURIComponent(anchor) + "&tz=" + tz),
  getSettings: () => api.req("/api/settings"),
  saveSettings: (b) => api.req("/api/settings", { method: "PATCH", body: b }),
  getProfile: () => api.req("/api/profile"),
  saveProfile: (b) => api.req("/api/profile", { method: "PUT", body: b }),
  stats: (days = 7) => api.req("/api/stats?days=" + days),
};

// === состояние ===
const state = {
  settings: { timezone: "Europe/Moscow", theme_mode: "auto" },
  profile: { name: null, occupation: null, avatar_emoji: "🌿", bio: null },
  categories: [],
  calMode: "week",
  calAnchor: new Date(),
  filter: "all",
  search: "",
  tasks: [],
  editingId: null,
  route: "home",
};
const CAT_FALLBACK = { name: "Другое", emoji: "⚪", color: "#9aa0aa" };
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
  return (h >= 19 || h < 7) ? "dark" : "light";
}
function applyTheme() {
  const t = effectiveTheme(state.settings.theme_mode || "auto");
  document.documentElement.dataset.theme = t;
  const labels = { light: "Светлая", dark: "Тёмная", auto: "Авто" };
  $("#themeLabel").textContent = labels[state.settings.theme_mode || "auto"] || "Авто";
  $("#themeIcon").textContent = (state.settings.theme_mode || "auto") === "auto" ? "🌗" : (t === "dark" ? "🌙" : "☀️");
}
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
  const emoji = h < 6 ? "🌙" : h < 11 ? "☀️" : h < 17 ? "🌤" : h < 22 ? "🌆" : "🌙";
  return name ? `${part}, ${name} ${emoji}` : `${part} ${emoji}`;
}
function applyProfile() {
  const p = state.profile || {};
  const name = p.name?.trim();
  $("#heroGreeting").textContent = greetingText();
  $("#profileName").textContent = name || "Гость";
  $("#profileAvatar").textContent = p.avatar_emoji || (name ? name[0].toUpperCase() : "В");
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
function showRoute(name) {
  state.route = name;
  $$(".route").forEach(s => s.classList.toggle("hidden", s.dataset.view !== name));
  $$(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.route === name));
  if (name === "home") renderHome();
  if (name === "calendar") renderCalendar();
  if (name === "tasks") renderTasks();
  // маршрут "quick" больше не используется — быстрый ввод живёт инлайном на главной
  if (name === "settings") renderSettings();
  if (name === "profile") renderProfile();
}
$$(".nav-item").forEach(a => a.addEventListener("click", () => showRoute(a.dataset.route)));

$("#navToggle").addEventListener("click", () => {
  $("#nav").classList.toggle("open");
});
$$(".nav-item").forEach(a => a.addEventListener("click", () => $("#nav").classList.remove("open")));

window.addEventListener("hashchange", () => {
  const r = (location.hash || "#home").slice(1);
  if (["home", "calendar", "tasks", "settings", "profile"].includes(r)) showRoute(r);
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
    <div class="cat-stripe" style="background:${c.color}"></div>
    <div class="body">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="meta">
        <span class="tag" style="background:${c.color}">${c.emoji} ${escapeHtml(c.name)}</span>
        <span>🕐 ${escapeHtml(fmt.dateTime(t.start_at, state.settings.timezone))}</span>
        <span class="prio-dot p${t.priority || 3}" title="${priorityLabel(t.priority)}"></span>
        ${(t.reminders && t.reminders.length) ? `<span>🔔 ${t.reminders.length}</span>` : ""}
        ${t.postponed_count ? `<span>↻ ${t.postponed_count}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="icon-btn act-done" title="Завершить" aria-label="Завершить">✓</button>
      <button class="icon-btn act-edit" title="Редактировать" aria-label="Редактировать">✎</button>
    </div>
    <span class="prio-badge p${t.priority||3}" title="${priorityLabel(t.priority)}">${priorityLabel(t.priority)}</span>
  `;
  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".act-done")) {
      e.stopPropagation();
      api.completeTask(t.id).then(()=>{ toast("Завершено ✓"); refreshCurrent(); });
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
    <div class="cat-stripe" style="background:${c.color}"></div>
    <div class="body">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="meta">
        <span class="tag" style="background:${c.color}">${c.emoji} ${escapeHtml(c.name)}</span>
        <span>🕐 ${escapeHtml(fmt.dateTime(t.start_at, state.settings.timezone))}</span>
        <span class="prio-dot p${t.priority || 3}" title="${priorityLabel(t.priority)}"></span>
        <span class="prio-badge p${t.priority||3}" title="${priorityLabel(t.priority)}">${priorityLabel(t.priority)}</span>
        ${(t.reminders && t.reminders.length) ? `<span>🔔 ${t.reminders.map(reminderLabel).join(", ")}</span>` : ""}
        ${t.postponed_count ? `<span>↻ перенесена ${t.postponed_count}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="act" data-act="edit">✎ Редактировать</button>
      <button class="act" data-act="postpone">↻ Перенести</button>
      <button class="act ${t.status === 'done' ? 'success' : 'success'}" data-act="done">${t.status === 'done' ? '↺ Вернуть' : '✓ Завершить'}</button>
      <button class="act danger" data-act="del">🗑 Удалить</button>
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
      if (t.status === "done") api.reopenTask(t.id).then(()=>{ toast("Возвращено в работу"); refreshCurrent(); });
      else api.completeTask(t.id).then(()=>{ toast("Завершено ✓"); refreshCurrent(); });
    } else if (act === "del") {
      if (confirm("Удалить задачу?")) api.deleteTask(t.id).then(refreshCurrent);
    }
  });
  return wrap;
}

// === Главная ===
function renderHome() {
  applyProfile();
  Promise.all([api.home(), api.categories()]).then(([data, cats]) => {
    state.categories = cats;
    $("#heroDate").textContent = fmt.dayMonth(new Date().toISOString(), state.settings.timezone);
    const total = (data.now_tasks?.length || 0) + (data.soon_tasks?.length || 0) + (data.later_today?.length || 0) + (data.overdue?.length || 0);
    const postponed = (data.overdue?.length || 0);
    const important = (data.now_tasks?.length || 0);
    const soon = (data.soon_tasks?.length || 0);
    const summary = $("#heroSummary");
    summary.innerHTML = "";
    const hintEl = $("#heroHint");
    if (hintEl) {
      const name = state.profile?.name?.trim();
      const overloaded = (data.overdue || []).length > 0;
      const busy = total >= 6;
      const free = total === 0;
      let txt;
      if (free) txt = name ? `${name}, сегодня всё спокойно ✨` : "Сегодня всё спокойно ✨";
      else if (overloaded) txt = name ? `${name}, есть пара перенесённых — разложим по шагам` : "Есть пара перенесённых — разложим по шагам";
      else if (busy) txt = name ? `${name}, сегодня день плотный, но всё реально разложить по шагам` : "Сегодня день плотный, но всё реально разложить по шагам";
      else txt = name ? `${name}, сегодня спокойный день — ${total} задач` : `Сегодня спокойный день — ${total} задач`;
      hintEl.textContent = txt;
    }
    const pills = [
      { label: "Сегодня задач", value: total },
      { label: "Важных сейчас", value: important },
      { label: "Скоро", value: soon },
      { label: "Просрочено", value: postponed },
    ];
    for (const p of pills) {
      const el = document.createElement("span");
      el.className = "pill";
      el.innerHTML = `<strong>${p.value}</strong> ${p.label}`;
      summary.appendChild(el);
    }
    fillBucket("now", data.now_tasks || [], "На ближайший час ничего не запланировано");
    fillBucket("soon", data.soon_tasks || [], "Скоро ничего не запланировано");
    fillBucket("later", data.later_today || [], "Сегодня всё спокойно ✨");
    fillBucket("overdue", data.overdue || [], "Просроченных задач нет");
    fillBucket("done", data.done_today || [], "Завершённых пока нет");
  }).catch(e => toast("Не удалось загрузить данные: " + e.message, "err"));
}
function fillBucket(name, items, emptyText) {
  const list = $(`[data-bucket="${name}"]`);
  list.innerHTML = "";
  $("#cnt" + name.charAt(0).toUpperCase() + name.slice(1)).textContent = items.length;
  if (!items.length) {
    const e = document.createElement("div");
    e.className = "bucket-empty";
    e.textContent = emptyText;
    list.appendChild(e);
    return;
  }
  for (const t of items) list.appendChild(compactTaskCard(t));
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
    row.appendChild(cell);
  }
  wrap.appendChild(row);
  cont.appendChild(wrap);
  $("#calTitle").textContent = "Неделя: " + fmt.date(data.days[0].date + "T00:00:00") + " — " + fmt.date(data.days[6].date + "T00:00:00");
}
async function renderMonth() {
  const tz = state.settings.timezone;
  const cur = state.calAnchor;
  const y = cur.getFullYear(), m = cur.getMonth() + 1;
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
    e.innerHTML = `<span class="emoji">🌿</span>На этот день ничего не запланировано`;
    list.appendChild(e);
  } else {
    for (const t of data.tasks) list.appendChild(bigTaskCard(t));
  }
  cont.appendChild(list);
  $("#calTitle").textContent = fmt.dayMonth(data.date + "T00:00:00", tz);
}
function makeCalTask(t) {
  const c = catInfo(t.category);
  const el = document.createElement("div");
  el.className = "cal-task";
  el.style.borderLeftColor = c.color;
  el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block"></span> ${escapeHtml(fmt.time(t.start_at, state.settings.timezone))} · ${escapeHtml(t.title)}`;
  el.addEventListener("click", () => openSidePanel(t.id));
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
async function renderTasks() {
  const list = $("#taskList");
  list.innerHTML = "";
  if (state.filter === "today") {
    // единый источник с Главной: /api/home
    const data = await api.home();
    state.tasks = [
      ...(data.overdue || []),
      ...(data.now_tasks || []),
      ...(data.soon_tasks || []),
      ...(data.later_today || []),
    ];
  } else {
    state.tasks = await api.listTasks(state.filter, state.search);
  }
  if (!state.tasks.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.innerHTML = `<span class="emoji">🪴</span>Здесь пока пусто. Можно добавить новую задачу.`;
    list.appendChild(e);
    return;
  }
  for (const t of state.tasks) list.appendChild(bigTaskCard(t));
}
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
function renderQuick() { $("#quickPreview").classList.add("hidden"); $("#quickPreview").innerHTML = ""; }
async function quickPreviewFlow(text, container, onSave) {
  const tz = state.settings.timezone;
  const data = await api.quickPreview(text, tz);
  if (!data) { toast("Не удалось разобрать текст", "err"); return; }
  const cats = state.categories;
  container.classList.remove("hidden");
  container.innerHTML = `
    <h4>Проверь перед сохранением</h4>
    <div class="qp-row"><label>Название</label><input id="qpTitle" value="${escapeHtml(data.title)}"></div>
    <div class="qp-row"><label>Дата и время</label><input id="qpStart" type="datetime-local" value="${toLocalInput(data.start_at)}"></div>
    <div class="qp-row"><label>Категория</label><select id="qpCat">${cats.map(c => `<option value="${c.name}" ${c.name===data.category?'selected':''}>${c.emoji} ${c.name}</option>`).join("")}</select></div>
    <div class="qp-row"><label>Напоминание</label><select id="qpRem">
      <option value="">Без напоминания</option>
      <option value="30">За 30 минут</option>
      <option value="60" ${(data.reminders||[]).includes(60)?'selected':''}>За 1 час</option>
      <option value="120">За 2 часа</option>
      <option value="1440">За 1 день</option>
    </select></div>
    <div class="qp-actions">
      <button class="cta" id="qpSave">Сохранить</button>
      <button class="ghost" id="qpEdit">Изменить</button>
      <button class="ghost danger" id="qpCancel">Отменить</button>
      <span class="hint">Можно поправить любое поле</span>
    </div>
  `;
  $("#qpCancel").addEventListener("click", () => { container.classList.add("hidden"); container.innerHTML = ""; });
  $("#qpEdit").addEventListener("click", () => $("#qpTitle").focus());
  $("#qpSave").addEventListener("click", async () => {
    const rem = $("#qpRem").value;
    const payload = {
      title: $("#qpTitle").value.trim() || data.title,
      start_at: fromLocalInput($("#qpStart").value) || data.start_at,
      category: $("#qpCat").value,
      reminders: rem ? [Number(rem)] : [],
    };
    try {
      const created = await api.createTask(payload);
      toast("Задача добавлена", "ok");
      container.classList.add("hidden"); container.innerHTML = "";
      if (onSave) onSave(created);
    } catch (e) { toast("Не удалось сохранить: " + e.message, "err"); }
  });
}
const _qs=$("#quickSubmit");if(_qs) _qs.addEventListener("click", () => {
  const text = $("#quickText").value.trim();
  if (!text) return;
  quickPreviewFlow(text, $("#quickPreview"));
});
const _qt=$("#quickText");if(_qt) _qt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("#quickSubmit").click();
});
$("#openQuick").addEventListener("click", () => { document.getElementById("quickInlineInput").focus(); document.getElementById("quickInlineInput").scrollIntoView({behavior:"smooth",block:"center"}); });
let inlineDebounce;
$("#quickInlineInput").addEventListener("input", (e) => {
  clearTimeout(inlineDebounce);
  const text = e.target.value.trim();
  inlineDebounce = setTimeout(() => {
    if (text.length >= 3) quickPreviewFlow(text, $("#quickInlinePreview"));
    else { $("#quickInlinePreview").classList.add("hidden"); $("#quickInlinePreview").innerHTML = ""; }
  }, 350);
});
$("#quickInlineBtn").addEventListener("click", () => {
  const text = $("#quickInlineInput").value.trim();
  if (!text) return;
  quickPreviewFlow(text, $("#quickInlinePreview"));
});

// === Настройки ===
async function renderSettings() {
  const s = state.settings;
  const cats = state.categories;
  const g = $("#settingsGrid");
  g.innerHTML = "";
  const timezones = ["Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka"];
  g.innerHTML = `
    <div class="settings-card">
      <h3>Оформление</h3>
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
      <p class="hint" style="color:var(--text-mute);margin:0 0 12px;font-size:14px;line-height:1.5">
        Пока работают только <b>локальные browser reminders</b> — они сработают, если эта вкладка открыта в браузере.
        Полноценные 24/7 напоминания появятся после подключения backend / VPS / Telegram.
      </p>
    </div>
    <div class="settings-card">
      <h3>Категории</h3>
      <div class="inline">
        ${cats.map(c => `<span class="tag" style="background:${c.color}">${c.emoji} ${escapeHtml(c.name)}</span>`).join("")}
      </div>
      <p class="hint" style="color:var(--text-mute);margin:8px 0 0;font-size:13px">Цвет и эмодзи закреплены за категорией и одинаковы во всех формах.</p>
    </div>
  `;
  g.querySelectorAll("[data-tm]").forEach(b => b.addEventListener("click", () => {
    state.settings.theme_mode = b.dataset.tm;
    api.saveSettings({ theme_mode: b.dataset.tm });
    applyTheme();
    renderSettings();
  }));
  $("#setTz").addEventListener("change", (e) => { state.settings.timezone = e.target.value; api.saveSettings({ timezone: e.target.value }); applyProfile(); });
  $("#goProfile").addEventListener("click", () => showRoute("profile"));
}

// === Профиль ===
function renderProfile() {
  const p = state.profile;
  const g = $("#profileGrid");
  if (!g) return;
  g.innerHTML = `
    <div class="profile-card">
      <h3>Имя и аватар</h3>
      <div class="field"><label>Имя</label><input id="profileNameInput" value="${escapeHtml(p.name || '')}" placeholder="Как тебя зовут?"></div>
      <div class="field"><label>Чем занимаешься</label><input id="profileOcc" value="${escapeHtml(p.occupation || '')}" placeholder="Например: предприниматель"></div>
      <div class="field"><label>Аватар — эмодзи</label>
        <div class="profile-emoji-row" id="emojiRow">
          ${["🌿","🌸","☕","📓","✦","🪴","🌤","🌙"].map(e => `<button class="chip ${p.avatar_emoji===e?'active':''}" data-em="${e}">${e}</button>`).join("")}
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
  $$(".profile-emoji-row .chip").forEach(b => b.addEventListener("click", () => {
    $$(".profile-emoji-row .chip").forEach(x => x.classList.toggle("active", x === b));
    state.profile.avatar_emoji = b.dataset.em;
    $("#profileAvatar").textContent = b.dataset.em;
  }));
  g.querySelectorAll("[data-ptm]").forEach(b => b.addEventListener("click", () => {
    state.settings.theme_mode = b.dataset.ptm;
    api.saveSettings({ theme_mode: b.dataset.ptm });
    applyTheme();
    renderProfile();
  }));
  $("#profileTz").addEventListener("change", (e) => { state.settings.timezone = e.target.value; api.saveSettings({ timezone: e.target.value }); applyProfile(); });
  $("#profileSave").addEventListener("click", async () => {
    const name = $("#profileNameInput").value.trim();
    const occ = $("#profileOcc").value.trim();
    const updated = await api.saveProfile({ name: name || null, occupation: occ || null, avatar_emoji: state.profile.avatar_emoji });
    state.profile = updated;
    applyProfile();
    toast("Профиль сохранён", "ok");
  });
}

// === Боковая панель ===
function openSidePanel(id) {
  api.getTask(id).then(t => {
    if (!t) return;
    state.editingId = id;
    $("#sideTitle").textContent = t.title;
    const cats = state.categories;
    $("#sideForm").innerHTML = `
      <div class="sp-field"><label>Название</label><input id="spTitle" value="${escapeHtml(t.title)}"></div>
      <div class="sp-field"><label>Описание</label><textarea id="spDesc" rows="3" placeholder="Заметки, детали">${escapeHtml(t.description || '')}</textarea></div>
      <div class="sp-field"><label>Дата и время</label><input id="spStart" type="datetime-local" value="${toLocalInput(t.start_at)}"></div>
      <div class="sp-field"><label>Категория</label><select id="spCat">${cats.map(c => `<option value="${c.name}" ${c.name===t.category?'selected':''}>${c.emoji} ${c.name}</option>`).join("")}</select></div>
      <div class="sp-field"><label>Приоритет</label>
        <div class="sp-actions-row" id="spPrio">
          ${[1,2,3,4,5].map(p => `<button class="chip ${t.priority===p?'active':''}" data-p="${p}"><span class="prio-dot p${p}"></span> ${priorityLabel(p)}</button>`).join("")}
        </div>
      </div>
      <div class="sp-field"><label>Напоминание</label>
        <div class="sp-actions-row" id="spRem">
          <button class="chip ${!t.reminders?.length?'active':''}" data-r="">Без</button>
          <button class="chip ${t.reminders?.includes(30)?'active':''}" data-r="30">За 30 мин</button>
          <button class="chip ${t.reminders?.includes(60)?'active':''}" data-r="60">За 1 час</button>
          <button class="chip ${t.reminders?.includes(120)?'active':''}" data-r="120">За 2 часа</button>
          <button class="chip ${t.reminders?.includes(1440)?'active':''}" data-r="1440">За день</button>
        </div>
      </div>
      <div class="sp-field"><label>Действия</label>
        <div class="sp-actions-row">
          <button class="ghost" id="spPostpone">↻ Перенести</button>
          <button class="ghost ${t.status==='done'?'success':''}" id="spDone">${t.status==='done'?'↺ Вернуть':'✓ Завершить'}</button>
        </div>
      </div>
    `;
    let prio = t.priority;
    $$("#spPrio .chip").forEach(b => b.addEventListener("click", () => {
      prio = Number(b.dataset.p);
      $$("#spPrio .chip").forEach(x => x.classList.toggle("active", x === b));
    }));
    let rem = (t.reminders && t.reminders[0]) || "";
    $$("#spRem .chip").forEach(b => b.addEventListener("click", () => {
      rem = b.dataset.r;
      $$("#spRem .chip").forEach(x => x.classList.toggle("active", x === b));
    }));
    $("#spPostpone").addEventListener("click", () => openPostponeMenu(id));
    $("#spDone").addEventListener("click", () => {
      if (t.status === "done") api.reopenTask(id).then(() => { closeSidePanel(); refreshCurrent(); });
      else api.completeTask(id).then(() => { closeSidePanel(); refreshCurrent(); });
    });
    $("#sideOverlay").classList.add("open");
    $("#sidePanel").classList.add("open");
    $("#sidePanel").setAttribute("aria-hidden", "false");
    $("#sideSave").onclick = async () => {
      const payload = {
        title: $("#spTitle").value.trim() || t.title,
        description: $("#spDesc").value,
        start_at: fromLocalInput($("#spStart").value) || t.start_at,
        category: $("#spCat").value,
        priority: prio,
        reminders: rem ? [Number(rem)] : [],
      };
      await api.updateTask(id, payload);
      toast("Сохранено", "ok");
      closeSidePanel();
      refreshCurrent();
    };
    $("#sideDelete").onclick = () => {
      if (confirm("Удалить задачу?")) { api.deleteTask(id).then(() => { closeSidePanel(); refreshCurrent(); }); }
    };
  });
}
function closeSidePanel() {
  $("#sideOverlay").classList.remove("open");
  $("#sidePanel").classList.remove("open");
  $("#sidePanel").setAttribute("aria-hidden", "true");
  state.editingId = null;
}
$("#sideClose").addEventListener("click", closeSidePanel);
$("#sideCancel").addEventListener("click", closeSidePanel);
$("#sideOverlay").addEventListener("click", closeSidePanel);

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
      doPostpone(id, { mode: "date", new_start: new Date(v).toISOString() });
    });
  }, 50);
}
function doPostpone(id, opts) {
  api.postpone(id, opts).then(() => { closeSidePanel(); refreshCurrent(); toast("Перенесено", "ok"); });
}

// === Старт ===
async function boot() {
  try {
    const [cats, settings, profile] = await Promise.all([api.categories(), api.getSettings(), api.getProfile()]);
    state.categories = cats;
    state.settings = { ...state.settings, ...settings };
    state.profile = profile;
    applyTheme();
    applyProfile();
    const r = (location.hash || "#home").slice(1);
    showRoute(["home", "calendar", "tasks", "settings", "profile"].includes(r) ? r : "home");
  } catch (e) {
    console.error(e);
    toast("Ошибка загрузки: " + e.message, "err");
  }
}
boot();
