'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { z } from 'zod';
import { registerSchema } from '@moncha/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { InlineAlert } from '@/components/app/states';
import { errorMessage, request } from '@/lib/api';

const formSchema = registerSchema
  .extend({ name: z.string().trim().min(1, 'Enter your name').max(100), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof formSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', password: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ confirm: _confirm, ...values }: FormValues) {
    setError(null);
    try {
      await request('/api/auth/register', { method: 'POST', body: values });
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Registration failed'));
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">New accounts join as operators. An admin can change your role.</p>
      </div>

      {error && (
        <InlineAlert variant="destructive" icon={AlertCircle} title="Could not create account">
          {error}
        </InlineAlert>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" placeholder="Jane Tan" autoFocus {...form.register('name')} />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters.">
          <PasswordInput id="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
