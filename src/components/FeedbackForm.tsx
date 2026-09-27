'use client';

import { useState, type FormEvent } from 'react';

/**
 * Public feedback form. Submits to POST /api/feedback (unauthenticated).
 * Includes a hidden honeypot field (`website`) that bots fill and humans
 * never see; the server silently discards those submissions.
 *
 * No field is auto-focused, so opening the page never pops up the mobile
 * keyboard.
 */
export function FeedbackForm({ initialArticle }: { initialArticle?: string }) {
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [articleSlug, setArticleSlug] = useState(initialArticle ?? '');
  const [website, setWebsite] = useState(''); // honeypot — hidden
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setState('idle');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          articleSlug: articleSlug.trim() || undefined,
          website,
        }),
      });
      if (!res.ok) throw new Error(`feedback failed: ${res.status}`);
      setMessage('');
      setName('');
      setEmail('');
      setArticleSlug('');
      setState('success');
    } catch {
      setState('error');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'mt-2 w-full rounded-lg border border-white/10 bg-transparent px-4 py-2 font-mono text-sm text-paper placeholder:text-muted/60 focus:border-signal/40 focus:outline-none';

  return (
    <form onSubmit={handleSubmit}>
      <label className="block font-mono text-xs uppercase tracking-[0.3em] text-muted">
        Message
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          maxLength={5000}
          placeholder="What should we correct, add, or reconsider?"
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block font-mono text-xs uppercase tracking-[0.3em] text-muted">
          Name (optional)
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="How should we address you?"
            className={inputClass}
          />
        </label>
        <label className="block font-mono text-xs uppercase tracking-[0.3em] text-muted">
          Email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            placeholder="Only used to reply"
            className={inputClass}
          />
        </label>
      </div>

      <label className="mt-4 block font-mono text-xs uppercase tracking-[0.3em] text-muted">
        About an article (optional)
        <input
          type="text"
          value={articleSlug}
          onChange={(e) => setArticleSlug(e.target.value)}
          maxLength={100}
          placeholder="Article slug, e.g. welcome"
          className={inputClass}
        />
      </label>

      {/* Honeypot: hidden from humans, attractive to bots. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full border border-signal/40 px-5 py-2 font-mono text-xs text-signal transition hover:bg-signal/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send feedback'}
        </button>
        {state === 'success' && (
          <p className="font-mono text-xs text-signal">Thanks — feedback received.</p>
        )}
        {state === 'error' && (
          <p className="font-mono text-xs text-muted">Something went wrong. Please try again.</p>
        )}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted/70">
        Stored: your message, plus the optional name, email, and article slug.
        No IP address or tracking is recorded. Email is used only to reply.
      </p>
    </form>
  );
}