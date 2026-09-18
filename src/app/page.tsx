import { ArticleCard } from '@/components/ArticleCard';
import { HeroVisual } from '@/components/HeroVisual';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getAllArticles, getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function Home() {
  const config = getSiteConfig();
  const sorted = getAllArticles()
    .filter((article) => article.status === 'published')
    .sort((a, b) => (Date.parse(b.logged) - Date.parse(a.logged)) || a.slug.localeCompare(b.slug))
    .slice(0, config.homepageCap);

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader overlay />
      <main className="flex-1">
        <section className="relative isolate overflow-hidden border-b border-white/10 px-6 pb-16 pt-40 sm:px-10 sm:pt-56">
          <HeroVisual heroImageUrl={config.theme.heroImageUrl} />
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

        <section className="border-t border-white/10 px-6 py-4 sm:px-10">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-muted">Articles</h2>
            <div className="mt-4">
              {sorted.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}