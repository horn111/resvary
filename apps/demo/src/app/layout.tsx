import type { Metadata, Viewport } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';

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
  metadataBase: new URL('https://resvary.vercel.app'),
  title: 'Resvary | Prepaid Credits and Usage Billing for AI Products',
  description:
    'Open-source TypeScript infrastructure for prepaid AI credits. Reserve spend before execution, charge actual usage, release the remainder, and issue auditable receipts.',
  applicationName: 'Resvary',
  keywords: [
    'prepaid AI credits',
    'AI usage billing',
    'usage metering SDK',
    'TypeScript billing SDK',
    'AI credit ledger',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Resvary',
    title: 'Resvary: Prepaid Credits for AI Products',
    description:
      'A retry-safe credit ledger for variable AI usage, with reservations, immutable prices, idempotency, and per-charge receipts.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Resvary: Prepaid Credits for AI Products',
    description:
      'Reserve spend before an AI request, charge actual usage, and release the remainder.',
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
      <body>{children}</body>
    </html>
  );
}
