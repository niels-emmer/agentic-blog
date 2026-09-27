import Link from 'next/link';

/**
 * Homepage pagination. Rendered only when the entry list spans more than one
 * page (page size = `homepageCap`). Page 1 lives at `/`; later pages at
 * `/?page=N`.
 */
export function Pagination({ currentPage, totalPages }: { currentPage: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const href = (n: number) => (n === 1 ? '/' : `/?page=${n}`);
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between pt-6 font-mono text-xs">
      {currentPage > 1 ? (
        <Link href={href(currentPage - 1)} className="text-muted transition hover:text-signal">
          ← Newer
        </Link>
      ) : (
        <span className="text-muted/40">← Newer</span>
      )}
      <span className="text-muted">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={href(currentPage + 1)} className="text-muted transition hover:text-signal">
          Older →
        </Link>
      ) : (
        <span className="text-muted/40">Older →</span>
      )}
    </nav>
  );
}