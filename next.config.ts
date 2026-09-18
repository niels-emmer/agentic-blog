import type { NextConfig } from 'next';

// Next.js dev mode's Fast Refresh runtime evaluates strings as JavaScript,
// which a strict script-src blocks. Keep production strict; allow 'unsafe-eval'
// only under `next dev` so client interactivity (e.g. the tag menu) hydrates.
const isDev = process.env.NODE_ENV === 'development';
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    // next/font self-hosts fonts at build time; the hero image is local by
    // default. 'unsafe-inline' for style is required by Tailwind-injected
    // styles; script-src 'unsafe-inline' covers Next.js inline bootstrap
    // scripts. fonts.googleapis.com / fonts.gstatic.com are needed for
    // runtime font switching (Epic 2); https: for images allows a remote
    // hero image configured via the theme.
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;