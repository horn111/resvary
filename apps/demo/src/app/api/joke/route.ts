import { nextPaywall } from '@settlary/sdk/middleware';

const DEMO_SELLER = '0x1111111111111111111111111111111111111111';

const jokes = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'There are only 10 types of people in the world: those who understand binary and those who don\'t.',
  'A SQL query walks into a bar, walks up to two tables and asks - "Can I join you?"',
  'Why did the blockchain developer quit? Because he lost his private key to success.',
  'What\'s a USDC\'s favorite dance? The stable shuffle.',
  'Why was the JavaScript developer sad? Because he didn\'t Node how to Express himself.',
  'How many developers does it take to change a light bulb? None - that\'s a hardware problem.',
  'Why do Arc validators make great friends? Because they always reach consensus.',
];

export const GET = nextPaywall(
  {
    price: '0.001',
    network: 'arc-testnet',
    payTo: DEMO_SELLER,
    description: 'Get a random developer joke - $0.001 USDC per request',
  },
  async () => {
    const joke = jokes[Math.floor(Math.random() * jokes.length)];

    return Response.json({
      joke,
      endpoint: '/api/joke',
      price: '0.001 USDC',
      billingModel: 'per-request',
      timestamp: new Date().toISOString(),
    });
  },
);
