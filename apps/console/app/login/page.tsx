import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { LoginForm } from './login-form';

function safeNext(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNext((await searchParams).next);
  const store = await cookies();
  if (verifySession(store.get(SESSION_COOKIE)?.value)) redirect(next);

  return <LoginForm next={next} demo={!process.env.WORKER_API_BASE_URL && !process.env.DATABASE_URL} />;
}
