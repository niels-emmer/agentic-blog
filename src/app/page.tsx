import type { Metadata } from 'next';

import { ArticleCard } from '@/components/ArticleCard';
import { HeroVisual } from '@/components/HeroVisual';
import { Pagination } from '@/components/Pagination';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getAllArticles, getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { page } = await searchParams;
  const n = Number.parseInt(page ?? '1', 10);
  // Paginated pages are slices of the same content — point search engines at page 1.
  return Number.isFinite(n) && n > 1 ? { alternates: { canonical: '/' } } : {};
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const config = getSiteConfig();
  const all = getAllArticles()
    .filter((article) => article.status === 'published')
    .sort((a, b) => (Date.parse(b.logged) - Date.parse(a.logged)) || a.slug.localeCompare(b.slug));
  const pageSize = config.homepageCap;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const requested = Number.parseInt(pageParam ?? '1', 10);
  const currentPage = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, totalPages) : 1;
  const entries = all.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink">
      <HeroVisual />
      <SiteHeader overlay />
      <main className="flex-1">
        <section className="px-6 pb-16 pt-40 sm:px-10 sm:pt-56">
          <div className="relative mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-signal">{config.heroKicker}</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {config.heroTitle}
            </h1>
            {config.heroParagraphs.map((paragraph, index) => (
              <p
                key={index}
                className={
                  index === 0
                    ? 'mt-6 max-w-2xl text-lg text-muted'
                    : 'mt-4 max-w-2xl text-sm text-muted'
                }
              >
                {paragraph}
              </p>
            ))}
          </div>
        </section>

        <section className="px-6 py-4 sm:px-10">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-muted">Articles</h2>
            <div className="mt-4">
              {entries.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}