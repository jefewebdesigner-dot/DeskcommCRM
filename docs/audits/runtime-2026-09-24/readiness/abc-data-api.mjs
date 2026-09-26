// External disposable-environment probe. Never loads .env or logs responses/tokens.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function settings(env) {
  const required = (key) => { assert.ok(env[key], `Missing ${key}`); return env[key]; };
  const base = new URL(required('ABC_DATA_API_URL'));
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)), 'HTTPS required');
  assert.ok(!base.username && !base.password && !base.search && !base.hash, 'URL must not contain credentials/query/fragment');
  assert.equal(required('ABC_DISPOSABLE_TARGET'), base.href, 'Explicit disposable target confirmation required');
  assert.equal(required('ABC_FIXTURES_VERIFIED'), 'A-only-B-only-C-none-no-admin-no-service', 'Fixture preflight required');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const orgs = ['A', 'B'].map((label) => required(`ABC_ORG_${label}`));
  orgs.forEach((org) => assert.match(org, uuid));
  assert.notEqual(orgs[0], orgs[1]);
  const actors = ['A', 'B', 'C'].map((label, index) => {
    const token = required(`ABC_JWT_${label}`);
    // Only fixture sanity: signature/authentication must be enforced by the Data API.
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()); }
    catch { throw new Error('JWT fixture payload is malformed'); }
    assert.match(claims.sub, uuid);
    assert.ok(claims.exp > Date.now() / 1000 + 120, 'JWT expired/too close to expiry');
    return { label, token, sub: claims.sub, org: orgs[index] };
  });
  assert.equal(new Set(actors.map((a) => a.sub)).size, 3, 'Distinct users required');
  return { base: base.href.replace(/\/$/, ''), actors };
}

export async function run(config, fetcher = fetch) {
  const { base, actors } = config;
  const fixtures = [];
  const request = async (actor, path, method = 'GET', body) => {
    const response = await fetcher(`${base}/${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`Non-JSON response (${response.status})`); }
    return { status: response.status, ok: response.ok, data };
  };
  const rows = (result) => { assert.ok(result.ok, `Expected success, got ${result.status}`); assert.ok(Array.isArray(result.data)); return result.data; };
  const hidden = (result) => {
    if (result.ok) assert.deepEqual(rows(result), [], 'Cross-organization rows returned');
    else assert.equal(result.status, 403, 'Only explicit authorization rejection accepted');
  };
  const ownerRead = async (fixture) => {
    const result = rows(await request(fixture.owner, `contacts?id=eq.${fixture.id}&select=id,organization_id,name`));
    assert.equal(result.length, 1); assert.equal(result[0].organization_id, fixture.owner.org);
    assert.equal(result[0].name, fixture.name);
  };
  try {
    {
      // Measured against this Neon Data API instance: every authentication
      // failure (malformed token, wrong kid, forged signature, missing
      // header) replies 400, never 401 — verified with three independent
      // malformed/forged tokens before relaxing this assertion. 400/401 both
      // mean "rejected before authorization"; only a 2xx or 403 here would be
      // the real problem (403 implies it parsed the token and evaluated a
      // policy, which a garbage token must never reach).
      const invalidStatus = (await request({ token: 'invalid' }, 'rpc/fn_user_org_ids', 'POST', {})).status;
      assert.ok([400, 401].includes(invalidStatus), `Invalid JWT must fail at authentication, got ${invalidStatus}`);
    }
    for (const actor of actors) {
      const memberships = rows(await request(actor, 'rpc/fn_user_org_ids', 'POST', {}));
      assert.deepEqual([...memberships].sort(), actor.org ? [actor.org] : [], `Membership mismatch ${actor.label}`);
    }
    for (const owner of actors.slice(0, 2)) {
      const fixture = { owner, id: randomUUID(), name: `ABC-disposable-${randomUUID()}` };
      fixtures.push(fixture); // Track before POST, including uncertain network outcomes.
      const created = rows(await request(owner, 'contacts', 'POST', { id: fixture.id, organization_id: owner.org, name: fixture.name }));
      assert.equal(created.length, 1); assert.equal(created[0].id, fixture.id);
      await ownerRead(fixture);
      fixture.name += '-updated';
      assert.equal(rows(await request(owner, `contacts?id=eq.${fixture.id}`, 'PATCH', { name: fixture.name })).length, 1);
      await ownerRead(fixture);
    }
    const seeded = [...fixtures];
    for (const actor of actors) {
      for (const target of seeded.filter((f) => f.owner !== actor)) {
        hidden(await request(actor, `contacts?id=eq.${target.id}&select=id,organization_id,name`));
        hidden(await request(actor, `contacts?organization_id=eq.${target.owner.org}&select=id&limit=1`));
        const attempted = { owner: target.owner, id: randomUUID(), name: 'ABC-forbidden-create' };
        fixtures.push(attempted);
        const created = await request(actor, 'contacts', 'POST', { id: attempted.id, organization_id: target.owner.org, name: attempted.name });
        assert.equal(created.status, 403, 'Foreign INSERT must fail authorization');
        assert.deepEqual(rows(await request(target.owner, `contacts?id=eq.${attempted.id}&select=id`)), []);
        hidden(await request(actor, `contacts?id=eq.${target.id}`, 'PATCH', { name: 'ABC-forbidden-update' }));
        await ownerRead(target);
        hidden(await request(actor, `contacts?id=eq.${target.id}`, 'DELETE'));
        await ownerRead(target);
      }
      if (actor.org) {
        const own = fixtures.find((f) => f.owner === actor);
        const other = actors.find((a) => a.org && a !== actor);
        assert.equal((await request(actor, `contacts?id=eq.${own.id}`, 'PATCH', { organization_id: other.org })).status, 403, 'WITH CHECK must block organization reassignment');
        await ownerRead(own);
      }
    }
  } finally {
    const failures = [];
    for (const fixture of fixtures) {
      try {
        rows(await request(fixture.owner, `contacts?id=eq.${fixture.id}`, 'DELETE'));
        assert.deepEqual(rows(await request(fixture.owner, `contacts?id=eq.${fixture.id}&select=id`)), []);
      } catch { failures.push(fixture.id); }
    }
    assert.deepEqual(failures, [], 'Cleanup failed for disposable fixture IDs');
  }
}

if (process.argv[1]?.endsWith('/abc-data-api.mjs')) {
  try { await run(settings(process.env)); process.stdout.write('PASS Data API: contacts A/B/C CRUD and organization reassignment; other surfaces NOT tested.\n'); }
  catch (error) { process.stderr.write(`FAIL ${error instanceof Error ? error.message : 'probe failed'}\n`); process.exitCode = 1; }
}
