'use client';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One settings group: title and explanation on the left, fields on the right (stacked on small screens). */
export function SettingsSection({
  id,
  title,
  description,
  children,
  aside,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-10 md:p-6">
        <div className="space-y-1.5">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold text-foreground">
            {title}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          {aside}
        </div>
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </Card>
  );
}

export function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  min,
  max,
  unit,
  disabled,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  min: number;
  max: number;
  unit?: string;
  disabled?: boolean;
}) {
  const describedBy = `${id}-help`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className="w-32 tabular-nums"
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      <p id={describedBy} className={cn('text-xs', error ? 'font-medium text-destructive' : 'text-muted-foreground')}>
        {error ?? (
          <>
            {hint ? <>{hint} · </> : null}
            {formatNumber(min)}–{formatNumber(max)}
          </>
        )}
      </p>
    </div>
  );
}

export function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}
