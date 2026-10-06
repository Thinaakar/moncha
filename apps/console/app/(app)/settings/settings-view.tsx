'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Database, KeyRound, LogOut, Server, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { changePasswordSchema, updateProfileSchema } from '@moncha/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-header';
import { Field } from '@/components/app/field';
import { PasswordInput } from '@/components/app/password-input';
import { useUser } from '@/components/app/user-context';
import { DetailRow } from '@/components/app/widgets';
import { api, errorMessage, request } from '@/lib/api';
import { useSystemHealth, useWorkerHealth } from '@/lib/queries';
import { formatDate, formatRelative, initials } from '@/lib/format';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROLE_COPY: Record<User['role'], string> = {
  admin: 'Full access, including user management.',
  operator: 'Can start crawls, import data and resolve reviews.',
  viewer: 'Read-only access to leads, reviews and jobs.',
};

type ProfileValues = z.infer<typeof updateProfileSchema>;

function ProfileCard() {
  const { user, setUser } = useUser();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user.name ?? '' },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit(values: ProfileValues) {
    try {
      const { user: updated } = await api<{ user: User }>('auth/me', { method: 'PATCH', body: values });
      setUser(updated);
      form.reset({ name: updated.name ?? '' });
      toast.success('Profile updated');
    } catch (err) {
      toast.error('Could not update profile', { description: errorMessage(err) });
    }
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-primary" /> Profile
          </CardTitle>
          <CardDescription>How you appear to your team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="flex items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {initials(user.name, user.email)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name || user.email}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full name" htmlFor="name" error={errors.name?.message}>
              <Input id="name" autoComplete="name" {...form.register('name')} />
            </Field>
            <Field label="Email" htmlFor="email" hint="Contact an admin to change your email.">
              <Input id="email" value={user.email} disabled readOnly />
            </Field>
          </div>
        </CardContent>
        <CardFooter className="mt-5 justify-end gap-2 border-t bg-muted/30 pt-5">
          <Button type="button" variant="ghost" disabled={!isDirty} onClick={() => form.reset()}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

const passwordForm = changePasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a password different from the current one',
    path: ['newPassword'],
  });
type PasswordValues = z.infer<typeof passwordForm>;

function PasswordCard() {
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ confirm: _confirm, ...values }: PasswordValues) {
    try {
      const res = await api<{ ok: boolean; otherSessionsRevoked: number }>('auth/change-password', {
        method: 'POST',
        body: values,
      });
      form.reset();
      toast.success('Password changed', {
        description: res.otherSessionsRevoked
          ? `Signed out ${res.otherSessionsRevoked} other session${res.otherSessionsRevoked === 1 ? '' : 's'}.`
          : undefined,
      });
    } catch (err) {
      const message = errorMessage(err);
      if (/current password/i.test(message)) form.setError('currentPassword', { message });
      else toast.error('Could not change password', { description: message });
    }
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" /> Password
          </CardTitle>
          <CardDescription>Changing it signs you out everywhere else</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5">
          <Field label="Current password" htmlFor="currentPassword" error={errors.currentPassword?.message}>
            <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register('currentPassword')} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="New password" htmlFor="newPassword" error={errors.newPassword?.message} hint="At least 8 characters.">
              <PasswordInput id="newPassword" autoComplete="new-password" {...form.register('newPassword')} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
              <PasswordInput id="confirm" autoComplete="new-password" {...form.register('confirm')} />
            </Field>
          </div>
        </CardContent>
        <CardFooter className="mt-5 justify-end border-t bg-muted/30 pt-5">
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function StatusDot({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) return <Skeleton className="h-5 w-16" />;
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CheckCircle2 className="size-4" /> Healthy
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-destructive">
      <XCircle className="size-4" /> Unavailable
    </span>
  );
}

function SystemCard() {
  const health = useSystemHealth();
  const worker = useWorkerHealth();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4 text-primary" /> System
        </CardTitle>
        <CardDescription>Live status of the backend services</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <dl className="divide-y">
          <DetailRow label="API">
            <StatusDot ok={health.error ? false : health.data?.ok} />
          </DetailRow>
          <DetailRow label="Database">
            <span className="inline-flex items-center gap-2">
              <Database className="size-3.5 text-muted-foreground" />
              <StatusDot ok={health.error ? false : health.data ? health.data.db === 'up' : undefined} />
            </span>
          </DetailRow>
          <DetailRow label="Worker">
            {worker.data ? (
              <span className={cn('inline-flex flex-col', worker.data.status === 'online' ? 'text-success' : 'text-destructive')}>
                <span className="font-medium">{worker.data.status === 'online' ? 'Online' : 'Offline'}</span>
                <span className="text-xs text-muted-foreground">{worker.data.message}</span>
              </span>
            ) : worker.error ? (
              <StatusDot ok={false} />
            ) : (
              <Skeleton className="h-5 w-16" />
            )}
          </DetailRow>
          {worker.data?.workers.map((w) => (
            <DetailRow key={w.workerId} label={w.hostname ?? 'Instance'}>
              <span className="flex items-center gap-2 text-xs">
                <span className={cn('size-2 rounded-full', w.online ? 'bg-success' : 'bg-muted-foreground/40')} />
                <span className="truncate font-mono text-muted-foreground">{w.workerId}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{formatRelative(w.lastSeenAt)}</span>
              </span>
            </DetailRow>
          ))}
          <DetailRow label="Workspace">
            <span className="font-mono text-xs">{health.data?.tenantId ?? '—'}</span>
          </DetailRow>
          <DetailRow label="Countries">
            <span className="flex flex-wrap gap-1">
              {health.data?.countries.map((c) => (
                <Badge key={c} variant="outline">
                  {c}
                </Badge>
              )) ?? '—'}
            </span>
          </DetailRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { user } = useUser();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" /> Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <dl className="divide-y">
          <DetailRow label="Role">
            <div className="space-y-1">
              <Badge variant={user.role === 'admin' ? 'default' : user.role === 'viewer' ? 'muted' : 'info'} className="capitalize">
                {user.role}
              </Badge>
              <p className="text-xs text-muted-foreground">{ROLE_COPY[user.role]}</p>
            </div>
          </DetailRow>
          <DetailRow label="Member since">{formatDate(user.createdAt)}</DetailRow>
          <DetailRow label="User ID">
            <span className="font-mono text-xs break-all">{user.id}</span>
          </DetailRow>
        </dl>
        <Button variant="outline" className="w-full" onClick={signOut} loading={signingOut}>
          {!signingOut && <LogOut />} Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile, password and see the health of the platform." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ProfileCard />
          <PasswordCard />
        </div>
        <div className="space-y-6">
          <AccountCard />
          <SystemCard />
        </div>
      </div>
    </div>
  );
}
