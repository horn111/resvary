import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Rubik, Syncopate } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const metric = Rubik({
  subsets: ['latin'],
  variable: '--font-metric',
  display: 'swap',
  weight: ['400', '500'],
});
const brand = Syncopate({
  subsets: ['latin'],
  variable: '--font-brand',
  display: 'swap',
  weight: '700',
});

export const metadata: Metadata = {
  title: 'Resvary Operator Console',
  description: 'Explain every balance. Recover every operational failure safely.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#090a0a',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${metric.variable} ${brand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
