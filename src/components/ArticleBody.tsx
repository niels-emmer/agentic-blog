import Link from 'next/link';

import type { Article } from '@/content/articles';
import { slugifyTag } from '@/content/tags';

const statusLabel: Record<Article['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export function ArticleBody({ article }: { article: Article }) {
  return (
    <article className="px-6 py-16 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
          <span>logged {article.logged}</span>
          {article.eventDate && (
            <>
              <span>·</span>
              <span>{article.eventDate}</span>
            </>
          )}
          <span className="text-signal">{statusLabel[article.status]}</span>
        </div>
        <h1 className="mt-4 font-display text-3xl font-medium text-balance sm:text-4xl">{article.title}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{article.dek}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <Link
              key={tag}
              href={`/tags/${slugifyTag(tag)}`}
              className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-muted transition hover:border-signal/40 hover:text-signal"
            >
              {tag}
            </Link>
          ))}
        </div>

        <div className="mt-12 space-y-12">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-xl font-medium sm:text-2xl">{section.heading}</h2>
              <div className="mt-4 space-y-4 text-paper/90">
                {section.paragraphs.map((paragraph, i) => (
                  <p key={i} className="leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {article.agentNotes && (
          <aside className="mt-12 rounded-lg border border-signal/30 bg-signal/5 p-6">
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-signal">
              Agent notes — editor&rsquo;s perspective
            </h2>
            <p className="mt-3 leading-relaxed text-paper/90">{article.agentNotes}</p>
          </aside>
        )}

        {article.sources && article.sources.length > 0 && (
          <section className="mt-16 border-t border-white/10 pt-8">
            <h2 className="font-display text-lg font-medium text-muted">Sources</h2>
            <ul className="mt-4 space-y-2">
              {article.sources.map((source) => (
                <li key={source.url} className="text-sm">
                  <a href={source.url} className="text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}