import { invoke } from '@forge/bridge';

/** Typed resolver call. Without the metadata option, invoke resolves to the body itself. */
export async function call<T>(key: string, payload?: Record<string, unknown>): Promise<T> {
  return (await invoke<T>(key, payload as any)) as T;
}
