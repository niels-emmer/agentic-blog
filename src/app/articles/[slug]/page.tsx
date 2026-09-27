import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArticleBody, statusLabel } from '@/components/ArticleBody';
import { HeroVisual } from '@/components/HeroVisual';
import { PageHero } from '@/components/PageHero';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getArticle, getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  const siteTitle = getSiteConfig().siteTitle;
  return {
    title: article ? `${article.title} — ${siteTitle}` : `Not found — ${siteTitle}`,
    description: article?.dek,
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getArticle(slug);

  // Drafts and archived entries are not public: only published articles render.
  if (!article || article.status !== 'published') {
    notFound();
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink">
      <HeroVisual />
      <SiteHeader overlay />
      <main className="flex-1">
        <PageHero
          kicker={statusLabel[article.status]}
          title={article.title}
          subtitle={article.dek}
        />
        <ArticleBody article={article} />
        <div className="mx-auto max-w-3xl px-6 pb-8 sm:px-10">
          <Link
            href={`/feedback?article=${article.slug}`}
            className="font-mono text-xs text-muted transition hover:text-signal"
          >
            Send feedback about this article →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}