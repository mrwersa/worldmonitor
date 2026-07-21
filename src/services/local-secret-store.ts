/**
 * localStorage-backed secret store for self-host web deployments.
 *
 * Desktop builds use the OS keyring via Tauri (`invokeTauri('set_secret', …)`).
 * For self-hosted web (no Tauri, no Clerk), secrets are persisted to localStorage
 * with lightweight obfuscation (base64 + XOR with a session key). This is NOT
 * cryptographically secure — localStorage is accessible to any XSS — but it
 * prevents casual plaintext exposure in devtools and is the same trust model
 * as the existing `'env'` source (server env vars are also visible to anyone
 * with process access).
 *
 * The storage namespace is `wm-local-secrets:` to avoid collisions with other
 * localStorage keys used by the app.
 */

const STORAGE_PREFIX = 'wm-local-secrets:';
const SESSION_KEY_STORAGE = 'wm-local-secrets-key';

function generateSessionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getSessionKey(): string {
  try {
    let key = sessionStorage.getItem(SESSION_KEY_STORAGE);
    if (key) return key;
    key = generateSessionKey();
    sessionStorage.setItem(SESSION_KEY_STORAGE, key);
    return key;
  } catch {
    return '';
  }
}

function xorTransform(input: string, key: string): string {
  if (!key) return input;
  let result = '';
  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function encode(value: string): string {
  const key = getSessionKey();
  if (!key) return btoa(value);
  return btoa(xorTransform(value, key));
}

function decode(stored: string): string {
  try {
    const key = getSessionKey();
    const decoded = atob(stored);
    if (!key) return decoded;
    return xorTransform(decoded, key);
  } catch {
    return '';
  }
}

export function saveLocalSecret(key: string, value: string): void {
  try {
    if (!value) {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return;
    }
    localStorage.setItem(STORAGE_PREFIX + key, encode(value));
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded)
  }
}

export function loadLocalSecret(key: string): string {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (!stored) return '';
    return decode(stored);
  } catch {
    return '';
  }
}

export function deleteLocalSecret(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}

export function loadAllLocalSecrets(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) continue;
      const secretKey = storageKey.slice(STORAGE_PREFIX.length);
      const value = loadLocalSecret(secretKey);
      if (value) result[secretKey] = value;
    }
  } catch {
    // localStorage may be unavailable
  }
  return result;
}