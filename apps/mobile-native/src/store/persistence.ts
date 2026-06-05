// @ts-nocheck
/**
 * persistence.ts — a tiny, FAILURE-SAFE key/value layer over AsyncStorage.
 *
 * AsyncStorage is a native module that only exists after a dev-build rebuild, so
 * we `require` it lazily and degrade to in-memory if it's absent. That keeps the
 * JS bundle runnable on the old build (reload-only iteration) and "just works"
 * once the native module is linked — no code change needed.
 *
 * Honest tradeoff (see docs/MOBILE_COMPANION.md): a team's secret `teamRootKey`
 * is stored here in plaintext so the phone stays linked across launches.
 * Encrypted-at-rest (expo-secure-store) is a deferred hardening.
 */
let AS: any = null;
try {
  // eslint-disable-next-line global-require
  AS = require('@react-native-async-storage/async-storage').default;
} catch (_e) {
  AS = null;
}

const mem = new Map<string, string>();

export const storage = {
  available: !!AS,

  async get(key: string): Promise<string | null> {
    try {
      if (AS) return await AS.getItem(key);
    } catch (_e) {
      /* fall through to mem */
    }
    return mem.has(key) ? mem.get(key)! : null;
  },

  async set(key: string, value: string): Promise<void> {
    mem.set(key, value);
    try {
      if (AS) await AS.setItem(key, value);
    } catch (_e) {
      /* mem already holds it */
    }
  },

  async remove(key: string): Promise<void> {
    mem.delete(key);
    try {
      if (AS) await AS.removeItem(key);
    } catch (_e) {
      /* noop */
    }
  },

  async keys(): Promise<string[]> {
    try {
      if (AS) return (await AS.getAllKeys()) || [];
    } catch (_e) {
      /* fall through */
    }
    return [...mem.keys()];
  },
};

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await storage.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (_e) {
    return fallback;
  }
}

export async function setJSON(key: string, value: any): Promise<void> {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch (_e) {
    /* noop */
  }
}
