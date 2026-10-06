'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Info, Plus, Radar, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { manualLeadSchema, type ManualLeadInput } from '@moncha/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/app/page-header';
import { Field } from '@/components/app/field';
import { InlineAlert } from '@/components/app/states';
import { QueueBadge } from '@/components/app/status';
import { useCanEdit } from '@/components/app/user-context';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation, useDiscoveryOptions } from '@/lib/queries';
import type { ManualLeadResult } from '@/lib/types';

const EMPTY: ManualLeadInput = { name: '', domain: '', country: '', city: '', phone: '', address: '' };

/** Blank optional fields are omitted so the backend does not store empty strings. */
function clean(values: ManualLeadInput): ManualLeadInput {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as ManualLeadInput;
}

export default function NewLeadPage() {
  const canEdit = useCanEdit();
  const options = useDiscoveryOptions();
  const [result, setResult] = useState<ManualLeadResult | null>(null);
  const form = useForm<ManualLeadInput>({ resolver: zodResolver(manualLeadSchema), defaultValues: EMPTY });
  const { errors } = form.formState;
  const create = useApiMutation(
    (input: ManualLeadInput) => api<ManualLeadResult>('leads', { method: 'POST', body: clean(input) }),
    [['leads']],
  );

  async function onSubmit(values: ManualLeadInput) {
    try {
      const res = await create.mutateAsync(values);
      setResult(res);
      toast.success(res.duplicate ? 'Existing company updated' : 'Lead created');
    } catch (e) {
      toast.error('Could not save the lead', { description: errorMessage(e) });
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'Leads', href: '/leads' }, { label: 'Add lead' }]}
        title="Add a lead"
        description="Add a single business by hand. Companies are matched on their domain, so duplicates are merged instead of created twice."
      />

      {!canEdit && (
        <InlineAlert variant="warning" title="Read-only account" className="mb-6">
          Viewers cannot add leads. Ask an admin to upgrade your role.
        </InlineAlert>
      )}

      {result ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
              <CheckCircle2 className="size-6" />
            </div>
            <h2 className="text-lg font-semibold">
              {result.duplicate ? 'Matched an existing company' : 'Lead created'}
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {result.company?.name}
              {result.duplicate ? ' was already in your workspace — blank fields were filled in.' : ' was added to your pipeline.'}{' '}
              {result.auditEnqueued
                ? 'A website audit has been queued and will qualify it automatically.'
                : 'No website was given, so no audit was queued.'}
            </p>
            {result.lead && (
              <div className="mt-4">
                <QueueBadge queue={result.lead.queue} />
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {result.lead && (
                <Button asChild>
                  <Link href={`/leads/${result.lead.id}`}>View lead</Link>
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  form.reset(EMPTY);
                  setResult(null);
                }}
              >
                <Plus /> Add another
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Business details</CardTitle>
              <CardDescription>Only the name is required. Add a domain to audit the website automatically.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field label="Company name" htmlFor="name" required error={errors.name?.message && 'Enter the company name'}>
                <Input id="name" placeholder="Orchard Dental Surgery" autoFocus aria-invalid={Boolean(errors.name)} {...form.register('name')} />
              </Field>
              <Field label="Website or domain" htmlFor="domain" hint="e.g. orcharddental.com.sg">
                <Input id="domain" placeholder="example.com" autoComplete="url" {...form.register('domain')} />
              </Field>
              <Field label="Country" htmlFor="country">
                <Input id="country" list="country-options" placeholder="Singapore" {...form.register('country')} />
                <datalist id="country-options">
                  {options.data?.countries.map((c) => <option key={c.code} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="City / area" htmlFor="city">
                <Input id="city" placeholder="Orchard" {...form.register('city')} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <Input id="phone" type="tel" placeholder="+65 6235 9999" {...form.register('phone')} />
              </Field>
              <Field label="Address" htmlFor="address">
                <Input id="address" placeholder="304 Orchard Road #05-01" {...form.register('address')} />
              </Field>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3 bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="size-3.5" /> Need many businesses?{' '}
                <Link href="/imports" className="font-medium text-primary hover:underline">
                  Import a CSV
                </Link>{' '}
                or{' '}
                <Link href="/discovery" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <Radar className="size-3" /> crawl a country
                </Link>
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => form.reset(EMPTY)}>
                  <RotateCcw /> Reset
                </Button>
                <Button type="submit" loading={create.isPending} disabled={!canEdit}>
                  Create lead
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>
      )}
    </div>
  );
}
