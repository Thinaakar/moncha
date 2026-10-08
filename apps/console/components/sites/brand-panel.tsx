'use client';

import { Bot, Clock, Globe, ImageOff, Mail, MapPin, MessageCircle, Palette, Phone, Sparkles, Type } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/app/states';
import { CopyButton } from '@/components/app/widgets';
import { siteFileUrl } from '@/lib/queries';
import type { SiteBrand, SiteManifest } from '@/lib/types';

const COLOR_ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;

/** Only http(s) links from the brand are clickable (the values come from a third-party page). */
function safeHref(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function Field({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm break-words">{children}</div>
      </div>
    </div>
  );
}

const none = <span className="text-muted-foreground">Not found</span>;

export function BrandPanel({
  brand,
  manifest,
  previewBase,
}: {
  brand: SiteBrand | null;
  manifest: SiteManifest | null;
  previewBase: string | null;
}) {
  if (!brand) {
    return <EmptyState icon={Palette} title="No brand details" description="Brand details are saved when the copy finishes." />;
  }
  const logo = brand.logo ? manifest?.assets.find((a) => a.id === brand.logo!.assetId) : undefined;
  const fromEvidence = brand.source === 'evidence';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {fromEvidence ? (
          <Badge variant="warning">From page data only (no AI)</Badge>
        ) : (
          <Badge variant="info">
            <Sparkles /> Extracted by AI, checked against the page
          </Badge>
        )}
        <span className="text-muted-foreground">Confidence {Math.round(brand.confidence * 100)}%</span>
        {brand.language && <Badge variant="outline">{brand.language}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex h-28 items-center justify-center rounded-lg border bg-[repeating-conic-gradient(#f1f4f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-4">
              {logo && previewBase ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={siteFileUrl(`${previewBase}${logo.storedPath}`)}
                  alt={`${brand.businessName ?? 'Business'} logo`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                  <ImageOff className="size-5" /> No logo found
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Business name</p>
              <p className="font-display text-lg font-semibold">{brand.businessName ?? '—'}</p>
            </div>
            {brand.tone && (
              <div>
                <p className="text-xs text-muted-foreground">Tone</p>
                <p className="text-sm">{brand.tone}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-primary" /> Colors and fonts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {COLOR_ROLES.map((role) => {
                const hex = brand.colors[role];
                return (
                  <div key={role} className="overflow-hidden rounded-lg border">
                    <div
                      className="h-16 border-b"
                      style={hex ? { background: hex } : { background: 'repeating-linear-gradient(45deg,#f1f4f9 0 6px,#fff 6px 12px)' }}
                    />
                    <div className="flex items-center justify-between gap-1 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground capitalize">{role}</p>
                        <p className="font-mono text-xs">{hex ?? '—'}</p>
                      </div>
                      {hex && <CopyButton value={hex} label={`Copy ${role} color`} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['heading', 'body'] as const).map((role) => (
                <div key={role} className="rounded-lg border p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
                    <Type className="size-3.5" /> {role} font
                  </p>
                  {brand.fonts[role] ? (
                    <>
                      <p className="mt-2 truncate text-2xl" style={{ fontFamily: `"${brand.fonts[role]}", system-ui, sans-serif` }}>
                        Aa Bb Cc 123
                      </p>
                      <p className="mt-1 text-sm font-medium">{brand.fonts[role]}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Not found</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact and hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field icon={Phone} label="Phone">
              {brand.contact.phones.length ? brand.contact.phones.join(', ') : none}
            </Field>
            <Field icon={Mail} label="Email">
              {brand.contact.emails.length ? brand.contact.emails.join(', ') : none}
            </Field>
            <Field icon={MessageCircle} label="WhatsApp">
              {brand.contact.whatsapp ?? none}
            </Field>
            <Field icon={MapPin} label="Address">
              {brand.contact.address ?? none}
            </Field>
            <Field icon={Clock} label="Opening hours">
              {brand.hours.length ? (
                <ul className="space-y-0.5">
                  {brand.hours.map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="min-w-28 text-muted-foreground">{h.days}</span>
                      <span className="tabular-nums">
                        {h.opens} – {h.closes}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                (brand.hoursText ?? none)
              )}
            </Field>
            <Field icon={Globe} label="Social links">
              {brand.socialLinks.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {brand.socialLinks.map((s) => {
                    const href = safeHref(s.url);
                    return (
                      <li key={s.url}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex">
                            <Badge variant="outline" className="hover:bg-muted">
                              {s.platform}
                            </Badge>
                          </a>
                        ) : (
                          <Badge variant="outline">{s.platform}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                none
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>What the business offers, as listed on the homepage</CardDescription>
          </CardHeader>
          <CardContent>
            {brand.services.length ? (
              <ul className="flex flex-wrap gap-2">
                {brand.services.map((s) => (
                  <li key={s} className="rounded-full border bg-muted/40 px-3 py-1 text-sm">
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No services found.</p>
            )}
            {brand.notes && <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">{brand.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Chatbot demo content
          </CardTitle>
          <CardDescription>Greeting and answers the MonCha widget shows in demo.html</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div className="overflow-hidden rounded-xl border shadow-sm">
            <div className="px-4 py-3 text-sm font-semibold text-white" style={{ background: brand.colors.primary ?? '#1877f2' }}>
              {brand.businessName ?? 'Assistant'}
            </div>
            <div className="space-y-2 bg-muted/30 p-4">
              <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm shadow-xs">{brand.chatbot.greeting}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {brand.chatbot.faqs.slice(0, 4).map((f, i) => (
                  <span key={i} className="rounded-full border bg-card px-2.5 py-1 text-xs">
                    {f.question}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {brand.chatbot.faqs.length ? (
            <dl className="divide-y rounded-lg border">
              {brand.chatbot.faqs.map((f, i) => (
                <div key={i} className="space-y-1 px-4 py-3">
                  <dt className="text-sm font-medium">{f.question}</dt>
                  <dd className="text-sm text-muted-foreground">{f.answer}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No FAQs were generated.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
