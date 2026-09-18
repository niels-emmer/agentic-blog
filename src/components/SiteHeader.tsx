import Link from 'next/link';

import { TagMenu } from '@/components/TagMenu';
import { getAllTags } from '@/content/tags';
import { getSiteConfig } from '@/lib/db';

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const tags = getAllTags();
  const config = getSiteConfig();
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-ink/40 px-6 py-6 backdrop-blur-md sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight text-paper">
            {config.siteTitle}
          </Link>
          <TagMenu tags={tags} />
        </div>
      </header>
      {/*
        Reserves the fixed header's height in normal flow so content doesn't
        start underneath it. Skipped when `overlay` is set — used on the
        homepage, where the hero image should show through the header and
        the hero section's own top padding already clears the title text.
      */}
      {!overlay && <div aria-hidden className="h-[80px]" />}
    </>
  );
}
