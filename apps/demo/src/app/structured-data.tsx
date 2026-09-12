import { SITE_DESCRIPTION, SITE_LAST_MODIFIED, SITE_NAME, SITE_URL } from './site';

const FAQ_ITEMS = [
  {
    question: 'Is Resvary a payment processor?',
    answer:
      'No. Resvary manages closed-loop product credits and usage authorization. Keep checkout, subscriptions, tax, and fiat payment processing in the systems you already use.',
  },
  {
    question: 'Does Resvary replace Stripe Billing, Lago, or Orb?',
    answer:
      'Resvary handles the real-time credit boundary around an AI operation. A broader billing platform can continue to handle checkout, subscriptions, invoicing, or finance workflows.',
  },
  {
    question: 'Why reserve credits before the AI request?',
    answer:
      'The final provider cost arrives after execution. A reservation prevents concurrent requests from spending the same available balance while keeping the final charge tied to actual usage.',
  },
  {
    question: 'What happens when the provider fails?',
    answer:
      'runMetered releases the full reservation when the provider callback throws. The account keeps its posted credits.',
  },
  {
    question: 'What happens if commit fails after the AI request succeeds?',
    answer:
      'The reservation stays open. Retry the commit with the same idempotency key to record the completed usage without charging twice.',
  },
  {
    question: 'Can an actual charge exceed its reservation?',
    answer:
      'No. Your application must create another reservation before continuing work that needs a higher limit.',
  },
  {
    question: 'Can I use my existing AI provider?',
    answer:
      'Yes. The core ledger does not depend on a model vendor. Your application passes estimated and actual usage into the SDK.',
  },
  {
    question: 'Do I need crypto or Arc to use Resvary?',
    answer:
      'No. Manual grants work without a blockchain. Direct Arc USDC and Gateway Nanopayments are Testnet funding options; neither changes the usage ledger.',
  },
  {
    question: 'Is SQLite production-ready?',
    answer:
      'SQLite targets local and single-node deployments. Use the Postgres deployment backend for multi-process deployments.',
  },
  {
    question: 'Are credits transferable or redeemable?',
    answer:
      'No. Resvary models non-transferable, non-redeemable product credits that customers use inside one merchant project.',
  },
  {
    question: 'Is a usage receipt a tax invoice?',
    answer:
      'No. A usage receipt explains an operational credit charge. Each merchant remains responsible for its customer terms, refund policy, privacy notice, invoices, and tax treatment.',
  },
  {
    question: 'Is Resvary free to use?',
    answer:
      'The current code is available under the Apache-2.0 license. No hosted paid plan exists yet.',
  },
  {
    question: 'How do I try Resvary?',
    answer:
      'Run the deterministic demo without an AI key, or open the repository and follow the getting-started guide.',
  },
] as const;

const organizationId = `${SITE_URL}/#organization`;
const websiteId = `${SITE_URL}/#website`;
const softwareId = `${SITE_URL}/#software`;
const webpageId = `${SITE_URL}/#webpage`;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/icon.svg`,
      },
      sameAs: ['https://github.com/horn111/resvary', 'https://x.com/resvaryAI'],
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: 'en',
      publisher: { '@id': organizationId },
    },
    {
      '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
      '@id': softwareId,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      image: `${SITE_URL}/og/resvary-social-card.png`,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js 20 or later',
      softwareVersion: '1.0.0',
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Node.js',
      codeRepository: 'https://github.com/horn111/resvary',
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      isAccessibleForFree: true,
      offers: {
        '@type': 'Offer',
        url: `${SITE_URL}/pricing.md`,
        price: '0',
        priceCurrency: 'USD',
        category: 'Open-source self-hosted software',
      },
      publisher: { '@id': organizationId },
      featureList: [
        'Atomic credit reservations before AI work begins',
        'Idempotent usage commits and releases',
        'Immutable price versions and auditable usage receipts',
        'SQLite for local and single-node use',
        'PostgreSQL for multi-process deployments',
      ],
    },
    {
      '@type': 'WebPage',
      '@id': webpageId,
      url: SITE_URL,
      name: 'Prepaid AI Credits and Usage Billing SDK',
      description: SITE_DESCRIPTION,
      isPartOf: { '@id': websiteId },
      about: { '@id': softwareId },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/og/resvary-social-card.png`,
        width: 1200,
        height: 630,
      },
      inLanguage: 'en',
      dateModified: SITE_LAST_MODIFIED,
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      url: `${SITE_URL}/#faq`,
      isPartOf: { '@id': webpageId },
      mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: answer,
        },
      })),
    },
  ],
};

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
      }}
    />
  );
}
