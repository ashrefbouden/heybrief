import { kvs } from '@forge/kvs';
import type { Store } from '../engine/ports';

// KVS keys allow letters, digits and : . _ - # and spaces. Account ids ("557058:abc-...") fit.
const SAFE = /^[A-Za-z0-9:._#\- ]{1,450}$/;
const k = (key: string) => {
  if (!SAFE.test(key)) throw new Error('invalid store key');
  return key;
};
const ttl = (s?: number) => (s ? { ttl: { value: Math.max(1, Math.ceil(s)), unit: 'SECONDS' as const } } : undefined);

export const forgeStore: Store = {
  async get<T>(key: string) {
    return (await kvs.get<T>(k(key))) ?? undefined;
  },
  async set<T>(key: string, value: T, ttlSeconds?: number) {
    await kvs.set(k(key), value, ttl(ttlSeconds));
  },
  async delete(key: string) {
    await kvs.delete(k(key));
  },
  async setIfAbsent<T>(key: string, value: T, ttlSeconds?: number) {
    try {
      await kvs.set(k(key), value, { keyPolicy: 'FAIL_IF_EXISTS', ...ttl(ttlSeconds) });
      return true;
    } catch (e) {
      // Distinguish "already exists" from a real failure without depending on the error class name.
      if ((await kvs.get(k(key))) !== undefined) return false;
      throw e;
    }
  },
};
