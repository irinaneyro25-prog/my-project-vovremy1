// @ts-nocheck
const baseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const botName = Deno.env.get('TELEGRAM_BOT_USERNAME');
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const jobKey = Deno.env.get('TELEGRAM_JOB_KEY');
const siteUrl = 'https://irinaneyro25-prog.github.io/my-project-vovremy1/';
const allowedOrigins = new Set(['https://irinaneyro25-prog.github.io',
  'http://127.0.0.1:4173', 'http://127.0.0.1:3000']);

function response(request, data, status = 200) {
  const origin = request.headers.get('origin');
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(allowedOrigins.has(origin) ? { 'access-control-allow-origin': origin } : {}),
      'access-control-allow-headers': 'authorization, apikey, content-type, x-job-key',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    },
  });
}

async function database(path, options = {}) {
  const result = await fetch(baseUrl + path, {
    method: options.method || 'GET',
    headers: {
      apikey: serviceKey,
      authorization: 'Bearer ' + serviceKey,
      'content-type': 'application/json',
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!result.ok) throw new Error('Database operation failed (' + result.status + ')');
  const text = await result.text();
  return text ? JSON.parse(text) : null;
}

async function account(request) {
  const token = request.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return null;
  const result = await fetch(baseUrl + '/auth/v1/user', {
    headers: { apikey: serviceKey, authorization: token },
  });
  return result.ok ? result.json() : null;
}

async function hashCode(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sendMessage(chatId, text) {
  const result = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!result.ok) throw new Error('Telegram returned ' + result.status);
}

async function markDelivery(delivery, fields) {
  const query = new URLSearchParams({
    owner_id: 'eq.' + delivery.owner_id,
    task_id: 'eq.' + delivery.task_id,
    start_at: 'eq.' + delivery.start_at,
    offset_minutes: 'eq.' + delivery.offset_minutes,
    attempts: 'eq.' + delivery.attempts,
    status: 'eq.sending',
  });
  await database('/rest/v1/telegram_deliveries?' + query, {
    method: 'PATCH', body: fields,
  });
}

async function runDeliveries() {
  const deliveries = await database('/rest/v1/rpc/claim_telegram_deliveries', {
    method: 'POST', body: { batch_size: 20 },
  });
  let sent = 0;
  for (const delivery of deliveries) {
    try {
      const taskFilter = new URLSearchParams({
        owner_id: 'eq.' + delivery.owner_id, id: 'eq.' + delivery.task_id,
        select: 'title,start_at,status,reminders',
      });
      const linkFilter = new URLSearchParams({
        owner_id: 'eq.' + delivery.owner_id, select: 'chat_id,privacy,active',
      });
      const [task] = await database('/rest/v1/planner_tasks?' + taskFilter);
      const [link] = await database('/rest/v1/telegram_links?' + linkFilter);
      if (!task || !link?.active || !['planned', 'in_progress'].includes(task.status) ||
          new Date(task.start_at).getTime() !== new Date(delivery.start_at).getTime() ||
          !task.reminders.includes(delivery.offset_minutes)) {
        await markDelivery(delivery, { status: 'cancelled' });
        continue;
      }
      const message = link.privacy === 'title'
        ? 'Напоминание: ' + task.title + '\n' + siteUrl
        : 'У вас запланировано дело\n' + siteUrl;
      await sendMessage(link.chat_id, message);
      await markDelivery(delivery, { status: 'sent', sent_at: new Date().toISOString(), last_error: null });
      sent++;
    } catch (error) {
      const failed = delivery.attempts >= 5;
      await markDelivery(delivery, {
        status: failed ? 'failed' : 'retry',
        next_attempt_at: new Date(Date.now() + Math.min(2 ** delivery.attempts, 60) * 60000).toISOString(),
        last_error: String(error.message).slice(0, 160),
      });
    }
  }
  return { claimed: deliveries.length, sent };
}

export default {
 async fetch(request) {
  if (request.method === 'OPTIONS') return response(request, {});
  try {
    const path = new URL(request.url).pathname.split('/').pop();
    if (path === 'webhook') {
      if (!webhookSecret || request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret)
        return response(request, { error: 'Unauthorized' }, 401);
      const update = await request.json();
      const chat = update.message?.chat;
      const command = update.message?.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/);
      if (chat?.type === 'private' && command) {
        const linked = await database('/rest/v1/rpc/consume_telegram_link', {
          method: 'POST', body: { request_hash: await hashCode(command[1]), telegram_chat: chat.id },
        });
        await sendMessage(chat.id, linked
          ? 'Telegram привязан к аккаунту «Вовремя».'
          : 'Ссылка истекла. Создайте новую в настройках «Вовремя».');
      }
      return response(request, { ok: true });
    }
    if (path === 'run') {
      if (!jobKey || request.headers.get('x-job-key') !== jobKey)
        return response(request, { error: 'Unauthorized' }, 401);
      return response(request, await runDeliveries());
    }
    const user = await account(request);
    if (!user?.id) return response(request, { error: 'Войдите в аккаунт' }, 401);
    if (path === 'link' && request.method === 'POST') {
      if (!botName || !botToken || !webhookSecret)
        return response(request, { error: 'Бот ещё не настроен' }, 503);
      const webhook = await fetch('https://api.telegram.org/bot' + botToken + '/setWebhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: baseUrl + '/functions/v1/telegram/webhook',
          secret_token: webhookSecret,
          allowed_updates: ['message'],
        }),
      });
      if (!webhook.ok || !(await webhook.json()).ok)
        throw new Error('Не удалось включить связь с Telegram');
      const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
        .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      await database('/rest/v1/telegram_link_requests?on_conflict=owner_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates',
        body: {
          owner_id: user.id, code_hash: await hashCode(code),
          expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
        },
      });
      return response(request, { url: 'https://t.me/' + botName + '?start=' + code });
    }
    if (path === 'status' && request.method === 'GET') {
      const query = new URLSearchParams({ owner_id: 'eq.' + user.id, select: 'active,privacy' });
      const [link] = await database('/rest/v1/telegram_links?' + query);
      return response(request, { linked: Boolean(link?.active), privacy: link?.privacy || 'neutral' });
    }
    if (path === 'privacy' && request.method === 'POST') {
      const body = await request.json();
      if (!['neutral', 'title'].includes(body.privacy)) return response(request, { error: 'Неверный вариант' }, 400);
      await database('/rest/v1/telegram_links?owner_id=eq.' + user.id, {
        method: 'PATCH', body: { privacy: body.privacy },
      });
      return response(request, { ok: true });
    }
    if (path === 'unlink' && request.method === 'POST') {
      await database('/rest/v1/telegram_links?owner_id=eq.' + user.id, { method: 'DELETE' });
      return response(request, { ok: true });
    }
    return response(request, { error: 'Not found' }, 404);
  } catch (error) {
    return response(request, { error: String(error.message) }, 500);
  }
 },
};
