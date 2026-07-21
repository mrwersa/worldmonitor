/**
 * localStorage-backed secret store for self-host web deployments.
 *
 * Desktop builds use the OS keyring via Tauri (`invokeTauri('set_secret', …)`).
 * For self-hosted web (no Tauri, no Clerk), secrets are persisted to localStorage
 * with lightweight obfuscation (base64 + XOR with a per-browser obfuscation
 * key). This is NOT cryptographically secure — localStorage is accessible to
 * any XSS — but it prevents casual plaintext exposure in devtools and is the
 * same trust model as the existing `'env'` source (server env vars are also
 * visible to anyone with process access).
 *
 * The obfuscation key is stored in localStorage (not sessionStorage): it
 * must outlive the browser session and be identical across every same-origin
 * tab, since the encoded secrets it protects live in localStorage, which is
 * both durable and shared across tabs. Keying it to sessionStorage instead
 * (each tab/session gets its own random key) would silently corrupt every
 * saved secret the moment the tab closes and reopens, or the moment a second
 * tab reads a value written by the first — exactly the case the cross-window
 * `storage` event listener in runtime-config.ts is meant to handle.
 *
 * The storage namespace is `wm-local-secrets:` to avoid collisions with other
 * localStorage keys used by the app.
 */

const STORAGE_PREFIX = 'wm-local-secrets:';
const OBFUSCATION_KEY_STORAGE = 'wm-local-secrets-key';

function generateObfuscationKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getObfuscationKey(): string {
  try {
    let key = localStorage.getItem(OBFUSCATION_KEY_STORAGE);
    if (key) return key;
    key = generateObfuscationKey();
    localStorage.setItem(OBFUSCATION_KEY_STORAGE, key);
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
  const key = getObfuscationKey();
  if (!key) return btoa(value);
  return btoa(xorTransform(value, key));
}

function decode(stored: string): string {
  try {
    const key = getObfuscationKey();
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