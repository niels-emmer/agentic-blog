import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArticleBody } from '@/components/ArticleBody';
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
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex-1">
        <ArticleBody article={article} />
      </main>
      <SiteFooter />
    </div>
  );
}