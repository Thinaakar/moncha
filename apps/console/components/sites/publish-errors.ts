import { humanize } from '@/lib/format';

export type PublishErrorInfo = {
  code: string;
  /** Plain-language summary. */
  title: string;
  /** What happens next, or what to do about it. */
  hint: string;
  /** The worker retries by itself; otherwise someone has to fix something first. */
  selfHealing: boolean;
};

const ERRORS: Record<string, Omit<PublishErrorInfo, 'code'>> = {
  github_rate_limited: {
    title: 'GitHub rate limit reached',
    hint: 'GitHub paused new pushes for a while. The worker waits and retries by itself.',
    selfHealing: true,
  },
  github_bad_token: {
    title: 'GitHub token rejected',
    hint: 'GITHUB_TOKEN on the worker is expired or revoked. Replace it, then retry.',
    selfHealing: false,
  },
  github_forbidden: {
    title: 'GitHub token lacks permission',
    hint: 'Give the token Contents and Administration: Read and write on all repositories, then retry.',
    selfHealing: false,
  },
  github_not_found: {
    title: 'GitHub owner or repository not found',
    hint: 'Check the GitHub owner in GITHUB_SITES_REPO and that the token can see it.',
    selfHealing: false,
  },
  github_rejected: { title: 'GitHub rejected the request', hint: 'See the message below, fix it, then retry.', selfHealing: false },
  github_unavailable: { title: 'GitHub is having problems', hint: 'A temporary GitHub error. The worker retries by itself.', selfHealing: true },
  github_unreachable: { title: 'Could not reach GitHub', hint: 'A network problem. The worker retries by itself.', selfHealing: true },
  github_bad_repo_name: { title: 'Invalid repository name', hint: 'The website name cannot be used as a GitHub repository name.', selfHealing: false },
  git_unavailable: { title: 'git is not available on the worker', hint: 'The worker image needs git installed.', selfHealing: false },
  git_failed: { title: 'git push failed', hint: 'The worker retries by itself; see the message below.', selfHealing: true },
  nothing_to_push: { title: 'No files to push', hint: 'The copy has no files. Make a new copy of this website.', selfHealing: false },
  nothing_to_deploy: { title: 'No files to deploy', hint: 'The copy has no files. Make a new copy of this website.', selfHealing: false },
  copy_files_missing: {
    title: "The copy's files are missing from R2",
    hint: 'Make a new copy of this website; this one cannot be published.',
    selfHealing: false,
  },
  worker_limit_reached: {
    title: 'Cloudflare Worker limit reached',
    hint: 'The account has no room for another Worker. Delete unused Workers or move to Workers Paid; it checks again by itself.',
    selfHealing: true,
  },
  cloudflare_bad_token: {
    title: 'Cloudflare token rejected',
    hint: 'CLOUDFLARE_API_TOKEN needs Workers Scripts: Edit on this account. Fix it, then retry.',
    selfHealing: false,
  },
  cloudflare_not_found: { title: 'Cloudflare account not found', hint: 'Check CLOUDFLARE_ACCOUNT_ID on the worker.', selfHealing: false },
  cloudflare_rate_limited: { title: 'Cloudflare rate limit reached', hint: 'The worker waits and retries by itself.', selfHealing: true },
  cloudflare_unavailable: { title: 'Cloudflare is having problems', hint: 'A temporary Cloudflare error. The worker retries by itself.', selfHealing: true },
  cloudflare_unreachable: { title: 'Could not reach Cloudflare', hint: 'A network problem. The worker retries by itself.', selfHealing: true },
  cloudflare_bad_bucket: { title: 'Cloudflare upload went wrong', hint: 'The worker retries by itself.', selfHealing: true },
  cloudflare_no_subdomain: {
    title: 'No workers.dev subdomain',
    hint: 'Set a workers.dev subdomain in Cloudflare (Workers & Pages), then retry.',
    selfHealing: false,
  },
  worker_name_taken: {
    title: 'Worker name already used',
    hint: 'A Worker with this name exists and was not made by MonCha. It was left untouched; rename or delete it in Cloudflare.',
    selfHealing: false,
  },
  worker_bad_name: { title: 'Invalid Worker name', hint: 'The website name cannot be used as a Worker name.', selfHealing: false },
  worker_shutdown: { title: 'The worker restarted mid-step', hint: 'It picks the step up again by itself.', selfHealing: true },
};

/** GitHub push and Worker deploy errors are stored as "code: message". */
export function publishErrorInfo(error: string | null | undefined): PublishErrorInfo | null {
  if (!error) return null;
  const code = /^([a-z0-9_]+):/.exec(error)?.[1] ?? 'error';
  const known = ERRORS[code];
  if (known) return { code, ...known };
  if (code.startsWith('cloudflare_http_')) {
    return { code, title: `Cloudflare answered HTTP ${code.slice(16)}`, hint: 'See the message below.', selfHealing: true };
  }
  if (code === 'error') return { code, title: 'Unexpected error', hint: 'The worker retries by itself; see the message below.', selfHealing: true };
  return { code, title: humanize(code), hint: 'See the message below.', selfHealing: true };
}

/** The message after the "code: " prefix. */
export function publishErrorDetail(error: string | null | undefined): string | null {
  if (!error) return null;
  return error.replace(/^[a-z0-9_]+:\s*/, '') || null;
}
