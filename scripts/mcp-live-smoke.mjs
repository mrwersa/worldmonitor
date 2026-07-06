#!/usr/bin/env node
// Live production smoke for the MCP surface (#4937 / #4938 regression net).
//
// WHY THIS EXISTS: the two customer-facing MCP outages of 2026-07-06 were
// invisible to unit tests by construction:
//   #4937 — an advertised-but-auth-gated method (prompts/list) answered
//           HTTP 401 with JSON-RPC id:null; strict SDK clients (Claude
//           Desktop via mcp-remote) can't correlate that, hang 30s, and mark
//           the server unstable. Unit tests exercised the method WITH
//           credentials, so the anonymous path was never walked.
//   #4938 — the Cloudflare apex→www 301 excluded /mcp but not /oauth/*, so
//           mcp-remote's OAuth dynamic-client-registration POST was redirected,
//           converted to GET, and died with 405. No in-process test can see a
//           CDN redirect rule.
//
// This script does what a strict anonymous MCP client does, against LIVE
// production, on BOTH hosts (the apex serves /mcp too, and apex-vs-www split
// is exactly where #4938 lived):
//   1. initialize → notifications/initialized → ping (the connect sequence)
//   2. a capability walk DERIVED from the initialize response — every
//      advertised capability's methods must answer 200 with the id echoed
//   3. the auth wall — anonymous tools/call must answer 401 (fast, not hang)
//   4. OAuth routing — the endpoints declared by
//      /.well-known/oauth-authorization-server must be reachable by POST
//      (no 3xx redirect, no 405 — the #4938 fingerprints). Probes use a
//      malformed body so nothing is ever registered/minted.
//
// Every request runs under a hard timeout: a transport-level hang (the #4937
// symptom) reports as HANG instead of stalling the job.
//
// Usage: node scripts/mcp-live-smoke.mjs
//   MCP_SMOKE_HOSTS=https://a,https://b  overrides the default host list.

const HOSTS = (process.env.MCP_SMOKE_HOSTS ?? 'https://worldmonitor.app,https://www.worldmonitor.app')
  .split(',').map((h) => h.trim()).filter(Boolean);
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'WorldMonitor-MCP-Smoke/1.0 (+https://worldmonitor.app; github-actions)';
// Bound the per-host resources/read sweep so a future large catalog can't blow
// the anon 60/min/IP limit (walk is ~17 calls/host today).
const MAX_RESOURCE_READS = 6;

// Capability key → methods the walk exercises. A capability advertised by the
// anonymous initialize with no mapping here fails the run — mirror of
// tests/mcp-anon-client-conformance.test.mjs.
const CAPABILITY_METHODS = {
  tools: ['tools/list'],
  prompts: ['prompts/list', 'prompts/get'],
  resources: ['resources/list', 'resources/templates/list', 'resources/read'],
  logging: ['logging/setLevel'],
  extensions: null,
};

const failures = [];
let checks = 0;

function fail(host, check, detail) {
  failures.push({ host, check, detail });
  console.log(`  ✖ [${host}] ${check}: ${detail}`);
}

function ok(host, check, detail = '') {
  console.log(`  ✔ [${host}] ${check}${detail ? ` — ${detail}` : ''}`);
}

async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    return { res, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

let nextId = 1;
// One JSON-RPC call. Returns the parsed result on success; records a failure
// and returns null otherwise. `expect` lets the auth-wall probe assert a 401.
async function rpc(host, method, params, { expectStatus = 200, label } = {}) {
  const check = label ?? method;
  checks += 1;
  const id = method.startsWith('notifications/') ? undefined : nextId++;
  const payload = { jsonrpc: '2.0', method, params };
  if (id !== undefined) payload.id = id;
  let res, ms;
  try {
    ({ res, ms } = await timedFetch(`${host}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    }));
  } catch (err) {
    fail(host, check, `HANG/transport error after ${TIMEOUT_MS}ms budget: ${err?.name ?? err}`);
    return null;
  }
  if (res.status !== expectStatus) {
    fail(host, check, `expected HTTP ${expectStatus}, got ${res.status} — a non-200 on a discovery method is uncorrelatable and hangs strict SDK clients (#4937)`);
    return null;
  }
  if (expectStatus === 202) { ok(host, check, `${ms}ms`); return {}; }
  let body;
  try {
    body = await res.json();
  } catch {
    fail(host, check, `HTTP ${res.status} but body is not JSON`);
    return null;
  }
  if (expectStatus === 200) {
    if (body.id !== id) {
      fail(host, check, `response id ${JSON.stringify(body.id)} does not echo request id ${id} — uncorrelatable (#4937)`);
      return null;
    }
    if (body.error) {
      fail(host, check, `JSON-RPC error: ${JSON.stringify(body.error)}`);
      return null;
    }
  }
  ok(host, check, `${ms}ms`);
  return body.result ?? body;
}

async function walkHost(host) {
  console.log(`\n── ${host} ──`);

  // 1. Connect sequence.
  const init = await rpc(host, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'wm-mcp-live-smoke', version: '1.0' },
  });
  if (!init) return; // nothing else is meaningful if the handshake fails
  await rpc(host, 'notifications/initialized', undefined, { expectStatus: 202 });
  await rpc(host, 'ping', {});

  // 2. Derived capability walk.
  const capabilities = init.capabilities ?? {};
  for (const capability of Object.keys(capabilities)) {
    if (!(capability in CAPABILITY_METHODS)) {
      checks += 1;
      fail(host, `capability:${capability}`,
        'advertised on the anonymous initialize but unmapped in this smoke — add the mapping AND ensure its methods are anonymously servable (#4937)');
      continue;
    }
    const methods = CAPABILITY_METHODS[capability];
    if (!methods) continue;
    for (const method of methods) {
      if (method === 'tools/list') {
        const r = await rpc(host, 'tools/list', {});
        if (r && !(Array.isArray(r.tools) && r.tools.length > 0)) fail(host, 'tools/list', 'empty catalog');
      } else if (method === 'prompts/list') {
        const r = await rpc(host, 'prompts/list', {});
        if (r && !(Array.isArray(r.prompts) && r.prompts.length > 0)) fail(host, 'prompts/list', 'empty catalog');
      } else if (method === 'prompts/get') {
        const list = await rpc(host, 'prompts/list', {}, { label: 'prompts/list (for get walk)' });
        for (const prompt of list?.prompts ?? []) {
          const args = {};
          for (const a of prompt.arguments ?? []) if (a.required) args[a.name] = 'DE';
          await rpc(host, 'prompts/get', { name: prompt.name, arguments: args }, { label: `prompts/get(${prompt.name})` });
        }
      } else if (method === 'resources/list') {
        const r = await rpc(host, 'resources/list', {});
        if (r && !(Array.isArray(r.resources) && r.resources.length > 0)) fail(host, 'resources/list', 'empty catalog');
      } else if (method === 'resources/templates/list') {
        const r = await rpc(host, 'resources/templates/list', {});
        if (r && !Array.isArray(r.resourceTemplates)) fail(host, 'resources/templates/list', 'missing resourceTemplates array');
      } else if (method === 'resources/read') {
        const list = await rpc(host, 'resources/list', {}, { label: 'resources/list (for read walk)' });
        for (const resource of (list?.resources ?? []).slice(0, MAX_RESOURCE_READS)) {
          await rpc(host, 'resources/read', { uri: resource.uri }, { label: `resources/read(${resource.uri})` });
        }
      } else if (method === 'logging/setLevel') {
        await rpc(host, 'logging/setLevel', { level: 'info' });
      }
    }
  }

  // 3. The auth wall must still answer — fast and with a 401, never a hang,
  //    never a silent anonymous data leak (200).
  await rpc(host, 'tools/call', { name: 'get_market_data', arguments: {} },
    { expectStatus: 401, label: 'tools/call (anon → 401 wall)' });

  // 4. OAuth routing (#4938): every endpoint the metadata declares must be
  //    POST-reachable — a 3xx means a CDN redirect will strip the POST
  //    (fetch converts 301/302 POST→GET), a 405 means the redirect already
  //    ate it. Malformed bodies keep the probes side-effect-free.
  checks += 1;
  let meta;
  try {
    const { res } = await timedFetch(`${host}/.well-known/oauth-authorization-server`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    meta = await res.json();
    ok(host, 'oauth metadata', 'served');
  } catch (err) {
    fail(host, 'oauth metadata', `not served: ${err?.message ?? err}`);
    return;
  }
  for (const key of ['registration_endpoint', 'token_endpoint']) {
    checks += 1;
    const endpoint = meta[key];
    if (typeof endpoint !== 'string') {
      fail(host, `oauth ${key}`, 'missing from metadata');
      continue;
    }
    try {
      const { res, ms } = await timedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{', // malformed on purpose: reaches the origin, registers nothing
      });
      if (res.status >= 300 && res.status < 400) {
        fail(host, `oauth ${key}`, `POST answered ${res.status} redirect → ${res.headers.get('location')} — a redirected POST becomes a GET and OAuth dies with 405 (#4938)`);
      } else if (res.status === 405) {
        fail(host, `oauth ${key}`, 'POST answered 405 — endpoint not accepting POST (#4938 fingerprint)');
      } else {
        ok(host, `oauth ${key}`, `POST reaches origin (HTTP ${res.status}, ${ms}ms)`);
      }
    } catch (err) {
      fail(host, `oauth ${key}`, `HANG/transport error: ${err?.name ?? err}`);
    }
  }
}

for (const host of HOSTS) {
  await walkHost(host);
}

console.log(`\n${checks} checks across ${HOSTS.length} host(s); ${failures.length} failure(s).`);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  [${f.host}] ${f.check}: ${f.detail}`);
  process.exit(1);
}
