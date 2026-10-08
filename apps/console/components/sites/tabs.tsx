'use client';

import { cn } from '@/lib/utils';

export type TabItem<T extends string> = {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
  disabled?: boolean;
};

/** Underlined tab bar (same look as the lead queues); the parent renders the active panel. */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:px-0', className)}>
      <div role="tablist" aria-label={label} className="inline-flex min-w-full gap-1 border-b">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {tab.icon && <tab.icon className={cn('size-4', active ? 'text-primary' : 'opacity-70')} />}
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[11px] tabular-nums',
                    active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Small segmented control for in-panel choices (preview mode, device width). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all [&_svg]:size-4',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon && <option.icon />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
