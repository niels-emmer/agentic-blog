import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArticleCard } from '@/components/ArticleCard';
import { HeroVisual } from '@/components/HeroVisual';
import { PageHero } from '@/components/PageHero';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import type { ArticleStatus } from '@/content/articles';
import { getAllArticles, getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_BY_SLUG: Record<string, ArticleStatus> = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
};

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ status: string }>;
}): Promise<Metadata> {
  const { status } = await params;
  const statusValue = Object.hasOwn(STATUS_BY_SLUG, status) ? STATUS_BY_SLUG[status] : undefined;
  const siteTitle = getSiteConfig().siteTitle;
  return {
    title: statusValue ? `${STATUS_LABELS[statusValue]} — ${siteTitle}` : `Not found — ${siteTitle}`,
  };
}

export default async function StatusPage({ params }: { params: Promise<{ status: string }> }) {
  const { status } = await params;
  // Object.hasOwn guards against prototype keys (/status/__proto__ etc.)
  // resolving to truthy inherited values.
  const statusValue = Object.hasOwn(STATUS_BY_SLUG, status) ? STATUS_BY_SLUG[status] : undefined;

  if (!statusValue) {
    notFound();
  }

  const label = STATUS_LABELS[statusValue];
  // Only published articles render on the public site; draft/archived status
  // pages are therefore empty (the API is the management surface for those).
  const matches = getAllArticles().filter(
    (article) => article.status === statusValue && article.status === 'published',
  );

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink">
      <HeroVisual />
      <SiteHeader overlay />
      <main className="flex-1">
        <PageHero
          kicker="Status"
          title={label}
          subtitle={`${matches.length} ${matches.length === 1 ? 'article' : 'articles'}`}
        />

        <section className="px-6 py-4 sm:px-10">
          <div className="mx-auto max-w-3xl">
            {matches.length === 0 ? (
              <p className="font-mono text-xs text-muted">No articles with this status yet.</p>
            ) : (
              matches.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}