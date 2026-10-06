import { CheckCircle2 } from 'lucide-react';
import { BrandLogo, BrandMark } from '@/components/brand';

const POINTS = [
  'Country-wide discovery across Singapore, Malaysia and Japan',
  'Three-pass website audits: HTML, rendered page and AI review',
  'A review queue for every uncertain verdict',
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#072a54] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse at 30% 40%, black 30%, transparent 75%)',
          }}
        />
        <div aria-hidden className="absolute -top-40 -right-40 size-[520px] rounded-full bg-[#1877f2]/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-48 -left-24 size-[420px] rounded-full bg-[#2b8cff]/20 blur-3xl" />
        <BrandMark className="absolute right-12 bottom-12 size-56 text-white/[0.04]" />

        <BrandLogo inverted className="relative" />

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-[#bbd9ff]">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Lead engine console
            </p>
            <h2 className="font-display text-4xl leading-[1.1] font-semibold tracking-tight">
              Find the businesses that still answer customers by hand.
            </h2>
            <p className="text-base text-[#c9d7ea]">
              MonCha discovers local businesses, audits their websites for chatbots and live chat, and hands you a
              qualified list ready for outreach.
            </p>
          </div>
          <ul className="space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-[#dbe7f6]">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#2b8cff]" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-[#8fa6c4]">© {new Date().getFullYear()} MonCha. Internal tool.</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="mb-10 lg:hidden">
          <BrandLogo />
        </div>
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
