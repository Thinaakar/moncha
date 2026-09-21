import type { Logger, WebsiteChecker, WebsiteRepo, WebsiteResult } from '../ports';
import { normalizeWebsiteUrl } from '../entities/company';

export async function checkWebsite(
  deps: { checker: WebsiteChecker; websites: WebsiteRepo; logger?: Logger },
  input: { tenantId: string; companyId: string; url: string },
): Promise<WebsiteResult> {
  const url = normalizeWebsiteUrl(input.url) ?? input.url;
  deps.logger?.info('website_check_started', {
    tenantId: input.tenantId,
    companyId: input.companyId,
    url,
  });

  const result = await deps.checker.check(url);
  await deps.websites.upsert({
    tenantId: input.tenantId,
    companyId: input.companyId,
    url,
    reachable: result.reachable,
    finalUrl: result.finalUrl,
    httpStatus: result.httpStatus,
    title: result.title,
    lastCheckedAt: new Date(),
  });

  deps.logger?.info('website_check_finished', {
    tenantId: input.tenantId,
    companyId: input.companyId,
    reachable: result.reachable,
    httpStatus: result.httpStatus,
  });

  return result;
}
