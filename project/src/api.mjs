// api.js — слой api, HTTP-роуты
export function buildApi(services) {
  const { taskService, calendarService, settingsService, statisticsService, backupService, profileService } = services;

  async function readJson(req) {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }
  function send(res, status, body, contentType = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'content-type': contentType });
    if (status === 204) return res.end();
    if (contentType.startsWith('application/json')) {
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    } else res.end(body);
  }
  function notFound(res) { send(res, 404, { error: 'not found' }); }
  function badRequest(res, msg) { send(res, 400, { error: msg || 'bad request' }); }
  function unauthorized(res) { send(res, 401, { error: 'unauthorized' }); }

  return { readJson, send, notFound, badRequest, unauthorized,
    taskService, calendarService, settingsService, statisticsService, backupService, profileService };
}

export async function handleApi(req, res, ctx, session) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  // публичный эндпоинт для проверки живости сервиса
  if (method === 'GET' && path === '/api/health') {
    return ctx.send(res, 200, { ok: true, ts: new Date().toISOString() });
  }

  // все остальные запросы требуют валидной сессии (HttpOnly cookie)
  if (!session || !session.user_id) {
    return ctx.unauthorized(res);
  }
  const userId = session.user_id;

  if (method === 'GET' && path === '/api/categories') {
    return ctx.send(res, 200, ctx.taskService.categories());
  }

  if (method === 'GET' && path === '/api/profile') {
    return ctx.send(res, 200, ctx.profileService.get(userId));
  }
  if (method === 'PUT' && path === '/api/profile') {
    const body = await ctx.readJson(req);
    return ctx.send(res, 200, ctx.profileService.update(userId, body || {}));
  }

  if (method === 'GET' && path === '/api/home') {
    return ctx.send(res, 200, ctx.taskService.homeBuckets(userId));
  }

  if (path === '/api/tasks') {
    if (method === 'GET') {
      const filter = url.searchParams.get('filter');
      const q = url.searchParams.get('q');
      let items = q
        ? ctx.taskService.search(userId, q)
        : (filter ? ctx.taskService.listForFilter(userId, filter) : ctx.taskService.listAll(userId));
      return ctx.send(res, 200, items);
    }
    if (method === 'POST') {
      try {
        const body = await ctx.readJson(req);
        const t = ctx.taskService.create(userId, body, body.source || 'web');
        return ctx.send(res, 201, t);
      } catch (e) { return ctx.badRequest(res, e.message); }
    }
  }

  if (method === 'POST' && path === '/api/quick-add') {
    const body = await ctx.readJson(req);
    if (!body.text) return ctx.badRequest(res, 'text is required');
    const t = ctx.taskService.createFromText(userId, body.text, body.timezone || 'Europe/Moscow');
    return ctx.send(res, 201, t);
  }

  if (method === 'POST' && path === '/api/quick-preview') {
    const body = await ctx.readJson(req);
    if (!body.text) return ctx.badRequest(res, 'text is required');
    return ctx.send(res, 200, ctx.taskService.previewFromText(body.text, body.timezone || 'Europe/Moscow'));
  }

  // /api/tasks/:id/* — все операции фильтруются по userId (владельцу записи)
  const m = path.match(/^\/api\/tasks\/(\d+)(\/(\w+))?$/);
  if (m) {
    const id = Number(m[1]);
    const sub = m[3];
    if (!sub && method === 'GET') {
      const t = ctx.taskService.get(userId, id);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
    if (!sub && method === 'PATCH') {
      const body = await ctx.readJson(req);
      const t = ctx.taskService.update(userId, id, body);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
    if (!sub && method === 'DELETE') {
      ctx.taskService.delete(userId, id);
      return ctx.send(res, 204, '');
    }
    if (sub === 'done' && method === 'POST') {
      const t = ctx.taskService.complete(userId, id);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
    if (sub === 'cancel' && method === 'POST') {
      const t = ctx.taskService.cancel(userId, id);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
    if (sub === 'reopen' && method === 'POST') {
      const t = ctx.taskService.reopen(userId, id);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
    if (sub === 'postpone' && method === 'POST') {
      const body = await ctx.readJson(req);
      const t = ctx.taskService.postpone(userId, id, body);
      return t ? ctx.send(res, 200, t) : ctx.notFound(res);
    }
  }

  if (method === 'GET' && path === '/api/calendar/month') {
    const y = Number(url.searchParams.get('year'));
    const m = Number(url.searchParams.get('month'));
    const tz = url.searchParams.get('tz') || 'Europe/Moscow';
    return ctx.send(res, 200, { year: y, month: m, cells: ctx.calendarService.monthGrid(userId, y, m, tz) });
  }
  if (method === 'GET' && path === '/api/calendar/week') {
    const anchor = url.searchParams.get('anchor') || new Date().toISOString();
    const tz = url.searchParams.get('tz') || 'Europe/Moscow';
    return ctx.send(res, 200, { anchor, days: ctx.calendarService.week(userId, anchor, tz) });
  }
  if (method === 'GET' && path === '/api/calendar/day') {
    const anchor = url.searchParams.get('anchor') || new Date().toISOString();
    const tz = url.searchParams.get('tz') || 'Europe/Moscow';
    return ctx.send(res, 200, ctx.calendarService.day(userId, anchor, tz));
  }

  if (path === '/api/settings') {
    if (method === 'GET') return ctx.send(res, 200, ctx.settingsService.get(userId));
    if (method === 'PATCH') {
      const body = await ctx.readJson(req);
      return ctx.send(res, 200, ctx.settingsService.update(userId, body));
    }
  }
  if (method === 'GET' && path === '/api/settings/profiles') {
    return ctx.send(res, 200, ctx.settingsService.profiles());
  }

  if (method === 'GET' && path === '/api/stats') {
    const days = Number(url.searchParams.get('days') || 7);
    return ctx.send(res, 200, ctx.statisticsService.summary(userId, days));
  }

  // /api/backup — наружу отдаём только имя и метаданные, без серверных путей
  if (method === 'POST' && path === '/api/backup') {
    const info = ctx.backupService.create(userId);
    return ctx.send(res, 200, { ok: true, name: info.name, created_at: info.created_at });
  }
  if (method === 'GET' && path === '/api/backup/list') {
    return ctx.send(res, 200, ctx.backupService.list(userId));
  }
  if (method === 'POST' && path === '/api/backup/import') {
    const body = await ctx.readJson(req);
    const added = ctx.backupService.import(userId, body.payload || {});
    return ctx.send(res, 200, { ok: true, imported: added });
  }

  ctx.notFound(res);
}
