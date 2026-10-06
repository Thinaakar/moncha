import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand';

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
      <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="relative space-y-6">
        <BrandLogo className="mx-auto" />
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Compass className="size-6" />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-sm font-medium text-primary">404</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Page not found</h1>
          <p className="mx-auto max-w-sm text-muted-foreground">
            The page you were looking for doesn&apos;t exist or was moved.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
