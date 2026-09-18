import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArticleCard } from '@/components/ArticleCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getArticlesForTag, getTagLabel } from '@/content/tags';
import { getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const label = getTagLabel(tag);
  const siteTitle = getSiteConfig().siteTitle;
  return {
    title: label ? `${label} — ${siteTitle}` : `Not found — ${siteTitle}`,
  };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const label = getTagLabel(tag);

  if (!label) {
    notFound();
  }

  const matches = getArticlesForTag(tag).filter((article) => article.status === 'published');

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b border-white/10 px-6 py-16 sm:px-10">
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-signal">Tag</p>
            <h1 className="mt-4 font-display text-3xl font-medium text-balance sm:text-4xl">{label}</h1>
            <p className="mt-4 text-muted">
              {matches.length} {matches.length === 1 ? 'article' : 'articles'}
            </p>
          </div>
        </section>

        <section className="px-6 py-4 sm:px-10">
          <div className="mx-auto max-w-3xl">
            {matches.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}