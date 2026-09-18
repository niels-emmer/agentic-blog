'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import type { TagEntry } from '@/content/tags';

export function TagMenu({ tags }: { tags: TagEntry[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open tag menu"
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
              aria-label="Close tag menu"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-ink/70"
            />
            <aside className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col border-l border-white/10 bg-ink px-6 py-6 sm:px-8">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-muted">Tags</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close tag menu"
                  className="text-muted transition hover:text-signal"
                >
                  ✕
                </button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 overflow-y-auto">
                {tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`/tags/${tag.slug}`}
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-muted transition hover:border-signal/40 hover:text-signal"
                  >
                    {tag.label}
                  </Link>
                ))}
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}