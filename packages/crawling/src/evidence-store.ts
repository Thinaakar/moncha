import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceStore, EvidenceStorePut } from '@moncha/domain';

/**
 * Local-disk EvidenceStore (SRS: local now, S3-compatible later).
 * Files land under `{root}/{tenantId}/{auditId}/{kind}-{hash}.{ext}`.
 */
export class LocalDiskEvidenceStore implements EvidenceStore {
  constructor(private rootDir: string) {}

  async put(input: EvidenceStorePut): Promise<{ objectUri: string }> {
    const ext = input.kind === 'screenshot' ? 'png' : 'html';
    const dir = path.join(this.rootDir, input.tenantId, input.auditId);
    await mkdir(dir, { recursive: true });
    const fileName = `${input.kind}-${input.contentHash.slice(0, 16)}.${ext}`;
    const full = path.join(dir, fileName);
    const bytes =
      typeof input.bytes === 'string' ? Buffer.from(input.bytes, 'utf8') : Buffer.from(input.bytes);
    await writeFile(full, bytes);
    // file:// URI for local retrieval; retentionClass is metadata for later GC.
    const objectUri = `file://${full.replace(/\\/g, '/')}`;
    return { objectUri };
  }
}

export function hashBytes(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return createHash('sha256').update(buf).digest('hex');
}

export function defaultEvidenceRoot(): string {
  return (
    process.env.EVIDENCE_DIR?.trim() ||
    path.resolve(process.cwd(), '.data', 'evidence')
  );
}
