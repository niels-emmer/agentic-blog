/** Pure string helpers shared by the DB layer, tag registry, and content API. */

export function slugifyTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derive an article slug from a title (used by the content API on create). */
export function slugifyTitle(title: string): string {
  return slugifyTag(title);
}