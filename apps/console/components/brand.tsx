import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" fill="none" aria-hidden className={cn('size-6', className)}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M29.3493 25.3568L20.5472 16.5546L16.5546 20.5472L25.3568 29.3493L29.3493 25.3568ZM8.76814 12.7607L12.7607 8.76814L3.99258 0L0 3.99258L8.76814 12.7607ZM0 25.3568L8.80241 16.5544L12.795 20.5469L3.99258 29.3493L0 25.3568ZM20.5814 12.7605L16.5889 8.76791L25.3568 0L29.3493 3.99258L20.5814 12.7605Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BrandLogo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-lg',
          inverted ? 'bg-white/10 text-[#2b8cff]' : 'bg-[#072a54] text-[#2b8cff]',
        )}
      >
        <BrandMark className="size-4" />
      </span>
      <span className={cn('font-display text-[17px] font-semibold tracking-tight', inverted ? 'text-white' : 'text-foreground')}>
        MonCha
      </span>
    </div>
  );
}
