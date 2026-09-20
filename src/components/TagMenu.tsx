'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { TagEntry } from '@/content/tags';
import type { SearchResult } from '@/lib/db';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

const statusLabel: Record<SearchResult['status'], string> = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
};

export function TagMenu({ tags }: { tags: TagEntry[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState(false);

  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  // Debounced search: fetch /api/search once the user pauses typing, abort
  // the in-flight request when the query changes or the drawer closes.
  useEffect(() => {
    if (!open || !searching) {
      setResults(null);
      setError(false);
      return;
    }
    setResults(null); // drop stale results while the new query is in flight
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searching, query]);

  function close() {
    setOpen(false);
    setQuery('');
    setResults(null);
    setError(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex flex-col justify-center gap-1.5 p-2 text-muted transition hover:text-signal"
      >
        <span className="block h-px w-5 bg-current" />
        <span className="block h-px w-5 bg-current" />
        <span className="block h-px w-5 bg-current" />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="absolute inset-0 bg-ink/70"
            />
            <aside className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col border-l border-white/10 bg-ink px-6 py-6 sm:px-8">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-muted">Search</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close menu"
                  className="text-muted transition hover:text-signal"
                >
                  ✕
                </button>
              </div>

              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the log…"
                autoFocus
                className="mt-4 w-full rounded-full border border-white/10 bg-transparent px-4 py-2 font-mono text-sm text-paper placeholder:text-muted/60 focus:border-signal/40 focus:outline-none"
              />

              <div className="mt-4 flex-1 overflow-y-auto">
                {searching ? (
                  error ? (
                    <p className="font-mono text-xs text-muted">Search unavailable.</p>
                  ) : results === null ? (
                    <p className="font-mono text-xs text-muted">Searching…</p>
                  ) : results.length === 0 ? (
                    <p className="font-mono text-xs text-muted">No results for “{query}”.</p>
                  ) : (
                    <ul className="space-y-4">
                      {results.map((result) => (
                        <li key={result.slug}>
                          <Link
                            href={`/articles/${result.slug}`}
                            onClick={close}
                            className="group block"
                          >
                            <div className="flex items-center gap-2 font-mono text-xs text-muted">
                              <span>{result.logged}</span>
                              <span className="text-signal">{statusLabel[result.status]}</span>
                            </div>
                            <div className="mt-1 font-display text-sm font-medium text-paper group-hover:text-signal">
                              {highlight(result.title, query)}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted">
                              {highlight(result.snippet, query)}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Link
                        key={tag.slug}
                        href={`/tags/${tag.slug}`}
                        onClick={close}
                        className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-muted transition hover:border-signal/40 hover:text-signal"
                      >
                        {tag.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Wrap the earliest term match in a <mark> styled as the accent color. */
function highlight(text: string, query: string): ReactNode {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (terms.length === 0) return text;
  const lower = text.toLowerCase();
  let idx = -1;
  let term = '';
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx === -1 || i < idx)) {
      idx = i;
      term = t;
    }
  }
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent text-signal">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}