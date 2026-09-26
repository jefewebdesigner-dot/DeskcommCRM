import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings, run } from './abc-data-api.mjs';

const A = { label: 'A', org: 'org-a', token: 'a' };
const B = { label: 'B', org: 'org-b', token: 'b' };
const C = { label: 'C', token: 'c' };

function database({ leak = false, noWriteCheck = false } = {}) {
  const records = new Map();
  return async (url, options) => {
    const actor = [A, B, C].find((a) => `Bearer ${a.token}` === options.headers.Authorization);
    const response = (status, body) => new Response(JSON.stringify(body), { status });
    if (!actor) return response(401, {});
    const path = new URL(url);
    if (path.pathname.endsWith('fn_user_org_ids')) return response(200, actor.org ? [actor.org] : []);
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (options.method === 'POST') {
      if (!noWriteCheck && body.organization_id !== actor.org) return response(403, {});
      records.set(body.id, body); return response(201, [body]);
    }
    const id = path.searchParams.get('id')?.slice(3);
    const org = path.searchParams.get('organization_id')?.slice(3);
    const matches = [...records.values()].filter((r) => (!id || r.id === id) && (!org || r.organization_id === org) && (leak || r.organization_id === actor.org));
    if (options.method === 'PATCH') {
      if (body.organization_id && body.organization_id !== actor.org && !noWriteCheck) return response(403, {});
      matches.forEach((r) => Object.assign(r, body));
    }
    if (options.method === 'DELETE') matches.forEach((r) => records.delete(r.id));
    return response(200, matches);
  };
}
const config = { base: 'https://disposable.invalid/rest/v1', actors: [A, B, C] };
test('refuses absent explicit disposable confirmation before network', () => {
  assert.throws(() => settings({ ABC_DATA_API_URL: 'https://disposable.invalid/rest/v1' }), /ABC_DISPOSABLE_TARGET/);
});
test('harness accepts isolated CRUD model (not real RLS evidence)', async () => {
  await run(config, database());
});
test('harness turns red when read isolation is sabotaged', async () => {
  await assert.rejects(run(config, database({ leak: true })), /Cross-organization/);
});
test('harness turns red when WITH CHECK is sabotaged', async () => {
  await assert.rejects(run(config, database({ noWriteCheck: true })), /Foreign INSERT/);
});
test('C authentication failure cannot pass as isolation', async () => {
  const transport = database();
  await assert.rejects(run(config, (url, options) =>
    options.headers.Authorization === 'Bearer c'
      ? Promise.resolve(new Response('{}', { status: 401 }))
      : transport(url, options)), /Expected success, got 401/);
});
