import { test } from 'node:test';
import assert from 'node:assert/strict';

const LS_PREFIX = 'wm-local-secrets:';
const SESSION_KEY_STORAGE = 'wm-local-secrets-key';

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

test('local-secret-store: handles missing localStorage gracefully', async () => {
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;

  const { saveLocalSecret, loadAllLocalSecrets } = await import('../src/services/local-secret-store.ts');

  saveLocalSecret('GROQ_API_KEY', 'should-not-throw');
  const all = loadAllLocalSecrets();
  assert.deepEqual(all, {});
});