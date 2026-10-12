"""UI smoke: python3 tests/browser_smoke.py (requires Python Playwright + Chromium)."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

PROJECT = Path(__file__).resolve().parents[1]
CHROMIUM = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')


def wait_server(url, process):
    for _ in range(50):
        if process.poll() is not None:
            raise RuntimeError('Server exited during startup')
        try:
            urllib.request.urlopen(url, timeout=1).close()
            return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Server startup timeout')


def scenario(browser, url, mode, artifacts):
    context = browser.new_context(viewport={'width': 1280, 'height': 1000})
    context.add_init_script("""window.permissionRequests = 0;
      const requestPermission = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => { window.permissionRequests++; return requestPermission(...args); };""")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    expect(page.locator('#heroSummary .pill')).to_have_count(4)
    expect(page.locator('.hero-brand h1')).to_have_text('Вовремя')
    expect(page.locator('.brand-slogan')).to_have_text('Спокойный день. Всё важное — вовремя.')
    expect(page.locator('.hero .cta')).to_have_count(1)
    assert page.evaluate("localStorage.getItem('vovremya.storage-mode')") == mode
    assert page.evaluate('window.permissionRequests') == 0
    page.evaluate("document.fonts.ready")
    assert page.evaluate("document.fonts.check('600 32px Manrope') && document.fonts.check('400 15px Inter')")

    # Обычная форма: имя профиля, дефолт 60, сохранение и единственная карточка.
    page.locator('[data-route="profile"]').click()
    page.locator('#profileNameInput').fill('Ирина')
    page.locator('#profileSave').click()
    expect(page.locator('#profileName')).to_have_text('Ирина')
    page.locator('[data-route="home"]').click()
    expect(page.locator('#heroGreeting')).to_contain_text('Ирина')
    page.locator('#openQuick').click()
    page.locator('#spTitle').fill('План встречи')
    expect(page.locator('#spRem [data-r="60"]')).to_have_class('chip active')
    page.locator('#sideSave').click()
    expect(page.locator('#home .task-card')).to_have_count(1)
    page.locator('[data-route="tasks"]').click()
    expect(page.locator('#taskList .task-card')).to_have_count(1)
    expect(page.locator('#taskList .meta')).to_contain_text('за 1 час')
    page.locator('[data-route="calendar"]').click()
    expect(page.locator('.cal-task')).to_have_count(1)
    page.locator('.cal-task .act-done').click()
    expect(page.locator('.cal-task.done')).to_have_count(1)
    page.locator('[data-route="tasks"]').click()
    expect(page.locator('#taskList .task-card.done')).to_have_count(1)

    # Карандаш сохраняет полную форму и заменяет дефолт ручным выбором.
    page.locator('#taskList [data-act="edit"]').click()
    page.locator('#spTitle').fill('План встречи изменён')
    page.locator('#spDesc').fill('Обсудить сроки')
    page.locator('#spRem [data-r="15"]').click()
    page.locator('#sideSave').click()
    expect(page.locator('#taskList .title')).to_have_text('План встречи изменён')
    expect(page.locator('#taskList .meta')).to_contain_text('за 15 мин')
    expect(page.locator('#taskList .meta')).not_to_contain_text('за 1 час')

    # Быстрый ввод не создаёт задачу до подтверждения, сохраняет выбранные 5 минут.
    page.locator('[data-route="home"]').click()
    page.locator('#quickInlineInput').fill('завтра в 10 Позвонить маме, напомни за 5 минут')
    page.locator('#quickInlineInput').press('Enter')
    expect(page.locator('#qpRem')).to_have_value('5')
    page.locator('#qpSave').click()
    expect(page.locator('#quickInlineInput')).to_have_value('')
    page.locator('[data-route="tasks"]').click()
    expect(page.locator('#taskList .task-card')).to_have_count(2)
    page.reload()
    expect(page.locator('#taskList .task-card')).to_have_count(2)
    page.locator('[data-route="calendar"]').click()
    page.locator('[data-mode="month"]').click()
    expect(page.locator('.cal-cell')).to_have_count(42)
    expect(page.locator('.cal-task')).to_have_count(2)

    # Разрешение выдаётся только после действия, реальный SW принимает уведомление.
    page.locator('[data-route="settings"]').click()
    expect(page.locator('#defaultReminder')).to_have_value('60')
    context.grant_permissions(['notifications'])
    page.locator('#remindersEnabled').check()
    expect(page.locator('#remindersEnabled')).to_be_checked()
    page.evaluate("navigator.serviceWorker.ready")
    assert page.evaluate("""async () => {
      const { showBrowserNotification } = await import('./static/reminders.js');
      const registration = await navigator.serviceWorker.ready;
      const shown = await showBrowserNotification({ title: 'Проверка уведомления', start: new Date().toISOString(), key: 'smoke-real-notification' }, registration, value => value);
      const notifications = await registration.getNotifications({tag:'smoke-real-notification'});
      const ok = shown && notifications.length === 1;
      notifications.forEach(n => n.close());
      return ok;
    }""")

    # Проверяем всю цепочку: сохранение -> планировщик -> настоящее уведомление SW.
    page.evaluate("""async () => {
      const { createPlannerApi } = await import('./static/planner-api.js');
      const api = createPlannerApi(); await api.init();
      await api.createTask({title:'Напоминание по расписанию',start_at:new Date(Date.now()+5*60000).toISOString(),reminders:[5]});
    }""")
    page.wait_for_function("""async () => {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications();
      return notifications.some(n => n.body.includes('Напоминание по расписанию'));
    }""", timeout=20000)
    page.evaluate("""async () => {
      const registration = await navigator.serviceWorker.ready;
      (await registration.getNotifications()).forEach(n => n.close());
      const { createPlannerApi } = await import('./static/planner-api.js');
      const api = createPlannerApi(); await api.init();
      const task = (await api.listTasks()).find(t => t.title === 'Напоминание по расписанию');
      await api.deleteTask(task.id);
    }""")

    # Просроченное напоминание появляется после нового открытия и не повторяется после просмотра.
    page.evaluate("""async () => {
      const { createPlannerApi } = await import('./static/planner-api.js');
      const api = createPlannerApi(); await api.init();
      await api.createTask({title:'Пропущенное дело',start_at:new Date(Date.now()+3*60000).toISOString(),reminders:[5]});
    }""")
    page.goto(url)
    expect(page.locator('#missedReminders')).to_be_visible()
    expect(page.locator('#missedList')).to_contain_text('Пропущенное дело')
    page.locator('#dismissMissed').click()
    expect(page.locator('#missedReminders')).to_be_hidden()
    page.reload()
    expect(page.locator('#heroSummary .pill')).to_have_count(4)
    expect(page.locator('#missedReminders')).to_be_hidden()

    page.screenshot(path=str(artifacts / f'{mode}-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 375, 'height': 812})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(artifacts / f'{mode}-mobile.png'), full_page=True)
    page.locator('#navToggle').click()
    page.locator('[data-route="calendar"]').click()
    expect(page.locator('#calendar')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert len(errors) == 0, errors

    if mode == 'local':
        # PWA восстанавливает статическую версию офлайн, в том числе на вложенном пути.
        page.locator('#navToggle').click()
        page.locator('[data-route="tasks"]').click()
        expect(page.locator('#taskList .task-card')).to_have_count(3)
        context.set_offline(True)
        page.reload()
        expect(page.locator('#taskList .task-card')).to_have_count(3)
        context.set_offline(False)
    context.close()
    print(f'PASS {mode}: brand, profile, create/edit/done, calendar/list, persistence, permissions, real SW notification, missed reminders, mobile' + (', offline PWA/subpath' if mode == 'local' else ''), flush=True)


def main():
    artifacts = Path(os.environ.get('BROWSER_ARTIFACTS', '/tmp/vovremya-browser'))
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='vovremya-browser-') as tmp:
        tmp = Path(tmp)
        server_dir = tmp / 'server'
        shutil.copytree(PROJECT, server_dir, ignore=shutil.ignore_patterns('.data', 'node_modules', '__pycache__'))
        shutil.copytree(PROJECT / 'public', tmp / 'site' / 'planner')
        log = open(artifacts / 'servers.log', 'w')
        server = subprocess.Popen(['node', 'server.mjs'], cwd=server_dir, stdout=log, stderr=log)
        static = subprocess.Popen(['python3', '-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', str(tmp / 'site')], stdout=log, stderr=log)
        try:
            wait_server('http://127.0.0.1:3000/api/health', server)
            wait_server('http://127.0.0.1:4173/planner/', static)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=CHROMIUM, headless=True, args=['--no-sandbox'])
                scenario(browser, 'http://127.0.0.1:3000/', 'server', artifacts)
                scenario(browser, 'http://127.0.0.1:4173/planner/', 'local', artifacts)
                browser.close()
        finally:
            for process in (server, static):
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()


if __name__ == '__main__':
    main()
