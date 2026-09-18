import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

import { ThemeProvider } from '@/components/ThemeProvider';
import { getSiteConfig } from '@/lib/db';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export async function generateMetadata(): Promise<Metadata> {
  const config = getSiteConfig();
  return {
    title: config.siteTitle,
    description: config.siteDescription,
    robots: config.robotsIndex
      ? { index: true, follow: true, nocache: false }
      : { index: false, follow: false, nocache: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0c0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ThemeProvider />
        {children}
      </body>
    </html>
  );
}
