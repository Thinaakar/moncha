import type { SiteStore, SiteStoreObject } from '@moncha/domain';

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** In-memory SiteStore for tests and local experiments. */
export class MemorySiteStore implements SiteStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string): Promise<SiteStoreObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { body: once(obj.bytes), contentType: obj.contentType, contentLength: obj.bytes.byteLength };
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes ?? null;
  }
}
