import { describe, expect, it, vi } from 'vitest';
import { BasicHttpWebsiteChecker, isPrivateIp } from './http-checker';

describe('website probe', () => {
  it('returns title and status on success', async () => {
    const checker = new BasicHttpWebsiteChecker({
      lookup: async () => ['93.184.216.34'],
      fetch: async () =>
        new Response('<html><title>Example</title></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });
    const result = await checker.check('https://example.com');
    expect(result).toMatchObject({ reachable: true, httpStatus: 200, title: 'Example' });
  });

  it('fails closed for private hosts and non-http protocols', async () => {
    const checker = new BasicHttpWebsiteChecker({
      lookup: async () => ['127.0.0.1'],
      fetch: vi.fn(),
    });
    expect((await checker.check('http://127.0.0.1')).reachable).toBe(false);
    expect((await checker.check('ftp://example.com')).reachable).toBe(false);
    expect((await checker.check('http://localhost')).error).toBe('blocked_host');
  });

  it('maps timeouts and dns failures', async () => {
    const timeoutChecker = new BasicHttpWebsiteChecker({
      timeoutMs: 5,
      lookup: async () => ['93.184.216.34'],
      fetch: async () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        throw error;
      },
    });
    expect((await timeoutChecker.check('https://example.com')).error).toBe('timeout');

    const dnsChecker = new BasicHttpWebsiteChecker({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect((await dnsChecker.check('https://no-such.example')).error).toBe('dns_failure');
  });

  it('identifies private IPs', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});
