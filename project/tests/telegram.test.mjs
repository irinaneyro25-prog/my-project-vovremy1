import test from 'node:test';
import assert from 'node:assert/strict';

test('Telegram требует секреты, связывает аккаунт и отменяет устаревшую отправку', async () => {
  const environment = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    TELEGRAM_BOT_TOKEN: 'bot-test',
    TELEGRAM_BOT_USERNAME: 'vovremya_test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-test',
    TELEGRAM_JOB_KEY: 'job-test',
  };
  let handler;
  globalThis.Deno = {
    env: { get: name => environment[name] },
  };
  const calls = [];
  const marked = [];
  let taskStatus = 'done';
  globalThis.fetch = async (address, options) => {
    const url = new URL(address);
    calls.push({ url: url.href, options });
    if (url.pathname === '/auth/v1/user') {
      assert.equal(options.headers.authorization, 'Bearer owner-token');
      return Response.json({ id: 'owner-1' });
    }
    if (url.pathname.endsWith('/setWebhook')) {
      assert.equal(JSON.parse(options.body).secret_token, 'webhook-test');
      return Response.json({ ok: true });
    }
    if (url.pathname === '/rest/v1/telegram_link_requests') {
      assert.equal(JSON.parse(options.body).owner_id, 'owner-1');
      return Response.json({});
    }
    if (url.pathname === '/rest/v1/rpc/consume_telegram_link') return Response.json(true);
    if (url.pathname.endsWith('/sendMessage')) return Response.json({ ok: true });
    if (url.pathname === '/rest/v1/rpc/claim_telegram_deliveries') {
      return Response.json([{
        owner_id: 'owner-1', task_id: 'task-1', start_at: '2026-11-18T12:00:00Z',
        offset_minutes: 60, attempts: 1,
      }]);
    }
    if (url.pathname === '/rest/v1/planner_tasks') {
      return Response.json([{ title: 'Задача', status: taskStatus,
        start_at: '2026-11-18T12:00:00Z', reminders: [60] }]);
    }
    if (url.pathname === '/rest/v1/telegram_links') {
      return Response.json([{ chat_id: 123, active: true, privacy: 'neutral' }]);
    }
    if (url.pathname === '/rest/v1/telegram_deliveries') {
      marked.push(JSON.parse(options.body).status);
      return Response.json({});
    }
    throw new Error('Unexpected request: ' + url.href);
  };
  handler = (await import('../../supabase/functions/telegram/index.js')).default.fetch;
  const endpoint = 'https://example.supabase.co/functions/v1/telegram/';
  const unauthorized = await handler(new Request(endpoint + 'run', { method: 'POST' }));
  assert.equal(unauthorized.status, 401);
  const untrusted = await handler(new Request(endpoint + 'webhook', { method: 'POST',
    body: JSON.stringify({ message: { chat: { id: 123, type: 'private' }, text: '/start bad' } }) }));
  assert.equal(untrusted.status, 401);
  const linked = await handler(new Request(endpoint + 'link', { method: 'POST',
    headers: { authorization: 'Bearer owner-token' } }));
  assert.equal(linked.status, 200);
  const link = (await linked.json()).url;
  assert.match(link, /^https:\/\/t\.me\/vovremya_test_bot\?start=/);
  const code = new URL(link).searchParams.get('start');
  const webhook = await handler(new Request(endpoint + 'webhook', { method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'webhook-test' },
    body: JSON.stringify({ message: { chat: { id: 123, type: 'private' }, text: '/start ' + code } }),
  }));
  assert.equal(webhook.status, 200);
  const run = await handler(new Request(endpoint + 'run', { method: 'POST',
    headers: { 'x-job-key': 'job-test' } }));
  assert.deepEqual(await run.json(), { claimed: 1, sent: 0 });
  assert.equal(calls.filter(call => call.url.endsWith('/sendMessage')).length, 1);
  taskStatus = 'planned';
  const next = await handler(new Request(endpoint + 'run', { method: 'POST',
    headers: { 'x-job-key': 'job-test' } }));
  assert.deepEqual(await next.json(), { claimed: 1, sent: 1 });
  assert.deepEqual(marked, ['cancelled', 'sent']);
  assert.equal(calls.filter(call => call.url.endsWith('/sendMessage')).length, 2);
});
