import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Prepaid AI Credits & Usage Billing SDK | Resvary',
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  authors: [{ name: SITE_NAME, url: 'https://github.com/horn111/resvary' }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'Developer software',
  referrer: 'origin-when-cross-origin',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  keywords: [
    'prepaid AI credits',
    'AI usage billing',
    'usage metering SDK',
    'TypeScript billing SDK',
    'AI credit ledger',
  ],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'Resvary: Prepaid Credits for AI Products',
    description:
      'A retry-safe credit ledger for variable AI usage, with reservations, immutable prices, idempotency, and per-charge receipts.',
    url: '/',
    locale: 'en_US',
    images: [
      {
        url: '/og/resvary-social-card.png',
        width: 1200,
        height: 630,
        alt: 'Resvary prepaid credits and usage billing for AI products',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@resvaryAI',
    creator: '@resvaryAI',
    title: 'Resvary: Prepaid Credits for AI Products',
    description:
      'Reserve spend before an AI request, charge actual usage, and release the remainder.',
    images: [
      {
        url: '/og/resvary-social-card.png',
        alt: 'Resvary prepaid credits and usage billing for AI products',
      },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetBrainsMono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
