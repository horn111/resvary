import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settlary - Prepaid AI Credits Demo',
  description:
    'Interactive prepaid credits, usage billing, reservations, and receipts for AI products.',
  openGraph: {
    title: 'Settlary - Prepaid AI Credits Demo',
    description: 'Reserve maximum AI cost, charge actual usage, and release the remainder.',
    url: 'https://settlary.vercel.app',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: 'Inter, -apple-system, sans-serif',
          backgroundColor: '#0d0d0d',
          color: '#f2f2f2',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
