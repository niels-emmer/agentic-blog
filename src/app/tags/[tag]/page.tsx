import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArticleCard } from '@/components/ArticleCard';
import { HeroVisual } from '@/components/HeroVisual';
import { PageHero } from '@/components/PageHero';
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
    <div className="relative isolate flex min-h-screen flex-col bg-ink">
      <HeroVisual />
      <SiteHeader overlay />
      <main className="flex-1">
        <PageHero
          kicker="Tag"
          title={label}
          subtitle={`${matches.length} ${matches.length === 1 ? 'article' : 'articles'}`}
        />

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