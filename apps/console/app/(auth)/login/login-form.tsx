'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { passwordLoginSchema, type PasswordLoginInput } from '@moncha/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { InlineAlert } from '@/components/app/states';
import { errorMessage, request } from '@/lib/api';

function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PasswordLoginInput>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: PasswordLoginInput) {
    setError(null);
    try {
      await request('/api/auth/login', { method: 'POST', body: values });
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Sign in failed'));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to the MonCha console to manage leads and discovery.</p>
      </div>

      {params.get('expired') && !error && (
        <InlineAlert variant="info" icon={Clock} title="Your session ended">
          Sign in again to continue where you left off.
        </InlineAlert>
      )}
      {params.get('reset') && !error && (
        <InlineAlert variant="success" title="Password updated">
          Sign in with your new password.
        </InlineAlert>
      )}
      {error && (
        <InlineAlert variant="destructive" icon={AlertCircle} title="Could not sign in">
          {error}
        </InlineAlert>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
            aria-invalid={Boolean(errors.email)}
            {...form.register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          action={
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New to MonCha?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
