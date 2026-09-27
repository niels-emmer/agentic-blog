import type { Metadata } from 'next';

import { FeedbackForm } from '@/components/FeedbackForm';
import { HeroVisual } from '@/components/HeroVisual';
import { PageHero } from '@/components/PageHero';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = getSiteConfig().siteTitle;
  return {
    title: `Feedback — ${siteTitle}`,
    description: 'Send corrections, sources, or comments about the site.',
  };
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string }>;
}) {
  const { article } = await searchParams;
  // Never trust the query string: only pass through a well-formed slug.
  const articleSlug = article && /^[a-z0-9-]+$/.test(article) && article.length <= 100 ? article : undefined;

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink">
      <HeroVisual />
      <SiteHeader overlay />
      <main className="flex-1">
        <PageHero
          kicker="Feedback"
          title="Corrections, sources, comments"
          subtitle="If you spotted an error, have a primary source, or disagree with an analysis, send it here."
        />
        <section className="px-6 pb-16 sm:px-10">
          <div className="mx-auto max-w-3xl">
            <FeedbackForm initialArticle={articleSlug} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}