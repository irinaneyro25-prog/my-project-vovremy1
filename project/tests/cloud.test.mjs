import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudApi } from '../public/static/cloud-api.js';

test('Облачный клиент входит и сохраняет изменения через Data API', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const userId = 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1';
  const rows = new Map();
  globalThis.fetch = async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://sxmaumiqmujgjzelxdrz.supabase.co');
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    if (url.pathname === '/auth/v1/token') {
      return Response.json({ access_token: 'token-a', refresh_token: 'refresh-a',
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId } });
    }
    assert.equal(options.headers.authorization, 'Bearer token-a');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId });
    if (url.pathname === '/auth/v1/logout') return Response.json({});
    assert.equal(url.pathname, '/rest/v1/planner_tasks');
    const method = options.method;
    const id = url.searchParams.get('id')?.slice(3);
    if (method === 'GET') return Response.json(id ? [rows.get(id)].filter(Boolean) : [...rows.values()]);
    if (method === 'POST') {
      const tasks = [options.body].flatMap(body => JSON.parse(body));
      const added = [];
      for (const task of tasks) {
        if (rows.has(task.id)) continue;
        const saved = { ...task, id: task.id || crypto.randomUUID() };
        rows.set(saved.id, saved);
        added.push(saved);
      }
      return Response.json(added);
    }
    if (method === 'PATCH') {
      assert.equal('id' in JSON.parse(options.body), false);
      const updated = { ...rows.get(id), ...JSON.parse(options.body) };
      rows.set(id, updated);
      return Response.json([updated]);
    }
    if (method === 'DELETE') {
      const deleted = rows.get(id);
      rows.delete(id);
      return Response.json(deleted ? [deleted] : []);
    }
    throw new Error('Unexpected request');
  };
  const client = createCloudApi('sb_publishable_test');
  assert.equal(await client.init(), false);
  await client.signIn('owner@example.com', 'test password');
  assert.equal(await client.init(), true);
  const created = await client.createTask({ title: 'Облачная задача', start_at: '2026-11-18T12:00:00Z' });
  assert.equal((await client.listTasks()).length, 1);
  assert.equal((await client.getTask(created.id)).title, 'Облачная задача');
  assert.equal((await client.updateTask(created.id, { title: 'Изменено' })).title, 'Изменено');
  assert.equal(await client.importTasks([{ id: created.id, title: 'Старая копия' }]), 0);
  assert.equal((await client.getTask(created.id)).title, 'Изменено');
  await client.deleteTask(created.id);
  assert.equal((await client.listTasks()).length, 0);
  await client.signOut();
  assert.equal(await client.init(), false);
});

test('Облачный клиент обновляет истёкший вход без смены аккаунта', async () => {
  const session = {
    access_token: 'expired', refresh_token: 'refresh-a',
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user: { id: 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1' },
  };
  const values = new Map([['vovremya.cloud.session.v1', JSON.stringify(session)]]);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  let refreshes = 0;
  globalThis.fetch = async (address, options) => {
    const url = new URL(address);
    if (url.pathname === '/auth/v1/token') {
      refreshes++;
      return Response.json({ ...session, access_token: 'new-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    assert.equal(options.headers.authorization, 'Bearer new-token');
    if (url.pathname === '/auth/v1/user') return Response.json(session.user);
    if (url.pathname === '/rest/v1/planner_tasks') return Response.json([]);
    throw new Error('Unexpected request');
  };
  const client = createCloudApi('sb_publishable_test');
  assert.equal(await client.init(), true);
  assert.deepEqual(await client.listTasks(), []);
  assert.equal(refreshes, 1);
});
