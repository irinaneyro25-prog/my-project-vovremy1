"""UI smoke: python3 tests/browser_smoke.py (requires Python Playwright + Chromium)."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid
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
        backup_scenario(browser, page, url, artifacts)
    context.close()
    print(f'PASS {mode}: brand, profile, create/edit/done, calendar/list, persistence, permissions, real SW notification, missed reminders, mobile' + (', offline PWA/subpath' if mode == 'local' else ''), flush=True)


def backup_scenario(browser, source, url, artifacts):
    source.goto(url + '#settings')
    with source.expect_download() as download:
        source.locator('#exportTasks').click()
    path = artifacts / 'task-backup.json'
    download.value.save_as(path)

    context = browser.new_context()
    page = context.new_page()
    page.goto(url + '#settings')
    picker = page.locator('#taskBackupFile')
    picker.set_input_files(str(path))
    expect(page.locator('#taskBackupStatus')).to_have_text('К добавлению: 3. Уже в списке: 0.')
    local = "JSON.parse(localStorage.getItem('vovremya.planner.v1'))?.tasks"
    assert page.evaluate(local) is None
    page.locator('#restoreTasks').click()
    expect(page.locator('#taskBackupStatus')).to_have_text('Добавлено: 3. Уже было в списке: 0.')
    assert len(page.evaluate(local)) == 3
    assert page.evaluate(local) == source.evaluate(local)

    page.reload()
    picker.set_input_files(str(path))
    expect(page.locator('#taskBackupStatus')).to_have_text('К добавлению: 0. Уже в списке: 3.')
    expect(page.locator('#restoreTasks')).to_be_hidden()
    page.evaluate("""async () => {
      const { createPlannerApi } = await import('./static/planner-api.js');
      const api = createPlannerApi(); await api.init();
      const [task] = await api.listTasks();
      await api.updateTask(task.id, { title: 'Новая версия задачи' });
      await api.deleteTask((await api.listTasks())[1].id);
    }""")
    picker.set_input_files(str(path))
    expect(page.locator('#taskBackupStatus')).to_have_text('К добавлению: 1. Уже в списке: 2.')
    page.locator('#restoreTasks').click()
    expect(page.locator('#taskBackupStatus')).to_have_text('Добавлено: 1. Уже было в списке: 2.')
    restored = page.evaluate(local)
    assert len(restored) == 3
    assert any(task['title'] == 'Новая версия задачи' for task in restored)
    picker.set_input_files({'name': 'broken.json', 'mimeType': 'application/json', 'buffer': b'{broken'})
    expect(page.locator('#taskBackupStatus')).to_have_text('Не удалось прочитать файл JSON')
    assert page.evaluate(local) == restored
    context.close()
    print('PASS backup: download, preview, restore, reload, repeat, merge, invalid file', flush=True)

def cloud_scenario(browser, url):
    tasks = {}
    outage = {'enabled': False}
    user_id = 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1'

    def open_account():
        context = browser.new_context()
        context.add_init_script("localStorage.setItem('vovremya.cloud.key.v1', 'sb_publishable_test')")

        def respond(route):
            request = route.request
            path = request.url.split('.co', 1)[1]
            method = request.method
            if path.startswith('/auth/v1/token'):
                data = {'access_token': 'test-access', 'refresh_token': 'test-refresh',
                        'expires_at': int(time.time()) + 3600, 'user': {'id': user_id}}
            elif path == '/auth/v1/user':
                data = {'id': user_id}
            elif path == '/functions/v1/telegram/status':
                data = {'linked': False, 'privacy': 'neutral'}
            elif path.startswith('/rest/v1/planner_tasks'):
                if outage['enabled']:
                    route.fulfill(status=503, content_type='application/json',
                                  body='{"message":"Service unavailable"}')
                    return
                assert request.headers['authorization'] == 'Bearer test-access'
                if method == 'GET':
                    data = list(tasks.values())
                elif method == 'POST':
                    incoming = request.post_data_json
                    data = []
                    for task in incoming if isinstance(incoming, list) else [incoming]:
                        task['id'] = task.get('id') or str(uuid.uuid4())
                        if task['id'] in tasks:
                            continue
                        task['status'] = task.get('status', 'planned')
                        task['postponed_count'] = task.get('postponed_count', 0)
                        tasks[task['id']] = task
                        data.append(task)
                elif method == 'PATCH':
                    task_id = path.split('id=eq.', 1)[1].split('&', 1)[0]
                    tasks[task_id].update(request.post_data_json)
                    data = [tasks[task_id]]
                else:
                    raise AssertionError(method)
            else:
                raise AssertionError(path)
            route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

        context.route('https://sxmaumiqmujgjzelxdrz.supabase.co/**', respond)
        page = context.new_page()
        page.goto(url)
        expect(page.locator('#cloudGate')).to_be_visible()
        page.locator('#cloudEmail').fill('owner@example.com')
        page.locator('#cloudPassword').fill('test password')
        page.locator('#cloudLogin button[type=submit]').click()
        expect(page.locator('#cloudGate')).to_be_hidden()
        return context, page

    first_context, first = open_account()
    first.locator('#openQuick').click()
    first.locator('#spTitle').fill('Задача из облака')
    first.locator('#sideSave').click()
    expect(first.locator('#home .task-card')).to_have_count(1)
    second_context, second = open_account()
    expect(second.locator('#home .task-card')).to_have_count(1)
    expect(second.locator('#home .task-card')).to_contain_text('Задача из облака')
    second.locator('#home .task-card .act-done').first.click()
    first.reload()
    expect(first.locator('#home .task-card.done')).to_have_count(1)
    second.goto(url + '#settings')
    backup = {
        'format': 'vovremya.tasks', 'version': 1,
        'tasks': [{'id': str(uuid.uuid4()), 'title': 'Перенесённая задача',
                   'start_at': '2026-12-01T12:00:00Z', 'status': 'planned',
                   'reminders': [60], 'timezone': 'Europe/Moscow'}],
    }
    second.locator('#cloudBackupFile').set_input_files({
        'name': 'tasks.json', 'mimeType': 'application/json',
        'buffer': json.dumps(backup).encode(),
    })
    expect(second.locator('#cloudBackupStatus')).to_have_text('К добавлению: 1. Уже в облаке: 0.')
    second.locator('#importCloudTasks').click()
    expect(second.locator('#cloudBackupStatus')).to_have_text('Добавлено: 1. Уже в облаке: 0.')
    second.locator('#cloudBackupFile').set_input_files({
        'name': 'tasks.json', 'mimeType': 'application/json',
        'buffer': json.dumps(backup).encode(),
    })
    expect(second.locator('#cloudBackupStatus')).to_have_text('К добавлению: 0. Уже в облаке: 1.')
    assert len(tasks) == 2
    outage['enabled'] = True
    first.reload()
    expect(first.locator('#cloudGate')).to_be_visible()
    expect(first.locator('#cloudLoginStatus')).to_contain_text('Service unavailable')
    first_context.close()
    second_context.close()
    print('PASS cloud mock: login, shared task, completion, idempotent import, outage', flush=True)


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
                cloud_scenario(browser, 'http://127.0.0.1:4173/planner/')
                browser.close()
        finally:
            for process in (server, static):
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()


if __name__ == '__main__':
    main()
