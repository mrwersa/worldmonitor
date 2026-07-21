import { test } from 'node:test';
import assert from 'node:assert/strict';

const LS_PREFIX = 'wm-local-secrets:';

function setupMockStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;

  const sessionStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => { sessionStore.set(k, v); },
    removeItem: (k: string) => { sessionStore.delete(k); },
    clear: () => { sessionStore.clear(); },
    key: (i: number) => Array.from(sessionStore.keys())[i] ?? null,
    get length() { return sessionStore.size; },
  } as Storage;
}

test('local-secret-store: save and load a secret', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'gsk_test_12345');
  const all = loadAllLocalSecrets();
  assert.equal(all['GROQ_API_KEY'], 'gsk_test_12345');
});

test('local-secret-store: stored value is obfuscated (not plaintext)', async () => {
  setupMockStorage();
  const { saveLocalSecret } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('OPENROUTER_API_KEY', 'sk-or-v1-secret');
  const stored = localStorage.getItem(LS_PREFIX + 'OPENROUTER_API_KEY');
  assert.ok(stored, 'value should be in localStorage');
  assert.ok(!stored.includes('sk-or-v1-secret'), 'stored value must not contain plaintext');
});

test('local-secret-store: delete a secret', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('FRED_API_KEY', 'fred_key_abc');
  assert.ok(loadAllLocalSecrets()['FRED_API_KEY']);

  const { deleteLocalSecret } = await import('../src/services/local-secret-store.ts');
  deleteLocalSecret('FRED_API_KEY');
  assert.ok(!loadAllLocalSecrets()['FRED_API_KEY']);
});

test('local-secret-store: empty value removes the secret', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('FINNHUB_API_KEY', 'fh_key');
  assert.ok(loadAllLocalSecrets()['FINNHUB_API_KEY']);

  saveLocalSecret('FINNHUB_API_KEY', '');
  assert.ok(!loadAllLocalSecrets()['FINNHUB_API_KEY']);
});

test('local-secret-store: loadAllLocalSecrets only returns wm-prefixed keys', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'gsk_abc');
  localStorage.setItem('unrelated-key', 'should-not-appear');
  localStorage.setItem('other-prefixed', 'nope');

  const all = loadAllLocalSecrets();
  assert.equal(Object.keys(all).length, 1);
  assert.equal(all['GROQ_API_KEY'], 'gsk_abc');
});

test('local-secret-store: secret survives sessionStorage being cleared (browser restart / new tab)', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'gsk_test_12345');
  assert.equal(loadAllLocalSecrets()['GROQ_API_KEY'], 'gsk_test_12345', 'sanity: reads back within the same session');

  // The obfuscation key must live in localStorage, not sessionStorage: it has
  // to outlive the browser session and be identical across every same-origin
  // tab, since the encoded secrets it protects are themselves in localStorage
  // (durable, cross-tab). Simulate a browser restart / brand-new tab, where
  // sessionStorage is empty but localStorage — including whatever the
  // obfuscation key is keyed on — persists.
  const freshSessionStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => freshSessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => { freshSessionStore.set(k, v); },
    removeItem: (k: string) => { freshSessionStore.delete(k); },
    clear: () => { freshSessionStore.clear(); },
    key: (i: number) => Array.from(freshSessionStore.keys())[i] ?? null,
    get length() { return freshSessionStore.size; },
  } as Storage;

  assert.equal(
    loadAllLocalSecrets()['GROQ_API_KEY'],
    'gsk_test_12345',
    'secret must still decode correctly with a fresh sessionStorage — a sessionStorage-keyed obfuscation key would silently corrupt this',
  );
});

test('local-secret-store: obfuscation key does not leak into loadAllLocalSecrets output', async () => {
  setupMockStorage();
  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'gsk_test_12345');
  const all = loadAllLocalSecrets();
  assert.equal(Object.keys(all).length, 1, 'only the actual secret should be returned, not the obfuscation key entry');
});

test('local-secret-store: handles missing localStorage gracefully', async () => {
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;

  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'should-not-throw');
  const all = loadAllLocalSecrets();
  assert.deepEqual(all, {});
});