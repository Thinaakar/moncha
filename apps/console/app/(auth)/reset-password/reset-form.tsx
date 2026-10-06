'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, KeyRound } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { InlineAlert } from '@/components/app/states';
import { api, errorMessage } from '@/lib/api';

const formSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await api('auth/reset-password', { method: 'POST', body: { token, password: values.password } });
      router.replace('/login?reset=1');
    } catch (e) {
      setError(errorMessage(e, 'Could not reset the password'));
    }
  }

  if (token.length < 16) {
    return (
      <div className="space-y-6">
        <InlineAlert variant="destructive" icon={AlertCircle} title="Invalid reset link">
          This link is missing its token. Request a new one from the sign-in page.
        </InlineAlert>
        <Button className="w-full" asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">You will be signed out of every other device.</p>
      </div>

      {error && (
        <InlineAlert variant="destructive" icon={AlertCircle} title="Reset failed">
          {error}{' '}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
        </InlineAlert>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters.">
          <PasswordInput id="password" autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  );
}
