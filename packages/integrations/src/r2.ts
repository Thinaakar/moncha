import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { SiteStore, SiteStoreObject } from '@moncha/domain';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type Env = Record<string, string | undefined>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isMissing(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return error.name === 'NoSuchKey' || error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404;
  }
  return false;
}

/** Private Cloudflare R2 bucket accessed through its S3-compatible API. */
export class R2SiteStore implements SiteStore {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
        Metadata: { sha256: await sha256Hex(bytes) },
      }),
    );
  }

  async get(key: string): Promise<SiteStoreObject | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!out.Body) return null;
      return {
        body: out.Body as unknown as AsyncIterable<Uint8Array>,
        contentType: out.ContentType ?? 'application/octet-stream',
        contentLength: out.ContentLength,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!out.Body) return null;
      return await out.Body.transformToByteArray();
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

export function r2ConfigFromEnv(env: Env = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** Returns null when any R2 key is missing (the site agent is then disabled). */
export function createR2SiteStoreFromEnv(env: Env = process.env): R2SiteStore | null {
  const config = r2ConfigFromEnv(env);
  return config ? new R2SiteStore(config) : null;
}
