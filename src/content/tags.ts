import { getAllArticles } from '@/lib/db';
import { slugifyTag } from '@/lib/slugify';

export { slugifyTag };

export interface TagEntry {
  slug: string;
  label: string;
}

// Canonical slug -> display-label registry, derived from the article data in
// SQLite. Any future tag normalizes through slugifyTag() before it's looked
// up, so a differently-cased variant of an existing tag (e.g. "Oversight" vs
// "oversight") resolves to the same entry instead of silently forking a
// second tag page. The label shown is whichever casing was authored first
// for that slug.
function buildRegistry(): Map<string, string> {
  const map = new Map<string, string>();
  for (const article of getAllArticles()) {
    for (const tag of article.tags) {
      const slug = slugifyTag(tag);
      if (!map.has(slug)) {
        map.set(slug, tag);
      }
    }
  }
  return map;
}

export function getAllTags(): TagEntry[] {
  return Array.from(buildRegistry().entries())
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getTagLabel(slug: string): string | undefined {
  return buildRegistry().get(slug);
}

export function getArticlesForTag(slug: string) {
  return getAllArticles().filter((article) =>
    article.tags.some((tag) => slugifyTag(tag) === slug),
  );
}