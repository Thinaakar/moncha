'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/components/app/field';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation, useDiscoveryOptions } from '@/lib/queries';
import type { Schedule } from '@/lib/types';

const ZONES = [
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Hong_Kong',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'UTC',
];

const COUNTRY_ZONE: Record<string, string> = { SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', JP: 'Asia/Tokyo' };

export function AddScheduleDialog({
  open,
  onOpenChange,
  defaultCountry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCountry?: string;
}) {
  const options = useDiscoveryOptions();
  const [country, setCountry] = useState('');
  const [time, setTime] = useState('09:00');
  const [timezone, setTimezone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !options.data) return;
    const code = defaultCountry || options.data.countries[0]?.code || '';
    setCountry(code);
    setTimezone(COUNTRY_ZONE[code] ?? options.data.defaults.timezone);
    setTime('09:00');
    setError(null);
  }, [open, defaultCountry, options.data]);

  const create = useApiMutation(
    (input: { country: string; time: string; timezone: string }) =>
      api<Schedule>('schedules', { method: 'POST', body: input }),
    [['schedules']],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Use a 24-hour time like 09:30');
      return;
    }
    try {
      const created = await create.mutateAsync({ country, time, timezone });
      toast.success(`${created.country} scheduled daily at ${created.time}`, {
        description: `Next run ${created.nextRunDay} (${created.timezone})`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const zones = ZONES.includes(timezone) || !timezone ? ZONES : [timezone, ...ZONES];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Add daily schedule</DialogTitle>
            <DialogDescription>
              Every day at this local time, the worker crawls the next slice of the country within the per-run budget.
            </DialogDescription>
          </DialogHeader>

          <Field label="Country">
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v);
                if (COUNTRY_ZONE[v]) setTimezone(COUNTRY_ZONE[v]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent>
                {options.data?.countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Time (24h)" htmlFor="time" error={error ?? undefined}>
              <Input
                id="time"
                type="time"
                step={60}
                value={time}
                onChange={(e) => {
                  setTime(e.target.value.slice(0, 5));
                  setError(null);
                }}
                required
              />
            </Field>
            <Field label="Time zone">
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue placeholder="Time zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!country || !timezone}>
              Add schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
