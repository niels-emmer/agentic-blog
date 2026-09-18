import Link from 'next/link';

import type { Article } from '@/content/articles';
import { slugifyTag } from '@/content/tags';

const statusLabel: Record<Article['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export function ArticleCard({ article }: { article: Article }) {
  return (
    <div className="border-b border-white/10 py-8 first:pt-0">
      <Link href={`/articles/${article.slug}`} className="group block transition">
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
          <span>{article.logged}</span>
          <span className="text-signal">{statusLabel[article.status]}</span>
        </div>
        <h2 className="mt-3 font-display text-2xl font-medium text-balance sm:text-3xl group-hover:text-signal">
          {article.title}
        </h2>
        <p className="mt-3 max-w-2xl text-muted">{article.dek}</p>
      </Link>
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
    </div>
  );
}