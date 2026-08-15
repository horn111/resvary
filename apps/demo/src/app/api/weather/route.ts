import { nextPaywall } from '@resvary/sdk/middleware';

const DEMO_SELLER = '0x1111111111111111111111111111111111111111';

interface WeatherData {
  city: string;
  temperature: number;
  humidity: number;
  conditions: string;
  wind: { speed: number; direction: string };
}

const mockWeather: Record<string, WeatherData> = {
  nyc: {
    city: 'New York City',
    temperature: 22,
    humidity: 65,
    conditions: 'Partly cloudy',
    wind: { speed: 15, direction: 'NW' },
  },
  london: {
    city: 'London',
    temperature: 16,
    humidity: 78,
    conditions: 'Overcast',
    wind: { speed: 12, direction: 'SW' },
  },
  tokyo: {
    city: 'Tokyo',
    temperature: 28,
    humidity: 72,
    conditions: 'Sunny',
    wind: { speed: 8, direction: 'SE' },
  },
  dubai: {
    city: 'Dubai',
    temperature: 38,
    humidity: 45,
    conditions: 'Clear',
    wind: { speed: 20, direction: 'N' },
  },
};

export const GET = nextPaywall(
  {
    price: '0.005',
    network: 'arc-testnet',
    payTo: DEMO_SELLER,
    description: 'Get weather data for a city - $0.005 USDC per request',
  },
  async (request: Request) => {
    const url = new URL(request.url);
    const city = (url.searchParams.get('city') ?? 'nyc').toLowerCase();

    const weather = mockWeather[city];

    if (!weather) {
      return Response.json(
        {
          error: 'City not found',
          available: Object.keys(mockWeather),
        },
        { status: 404 },
      );
    }

    return Response.json({
      ...weather,
      endpoint: '/api/weather',
      price: '0.005 USDC',
      billingModel: 'per-request',
      timestamp: new Date().toISOString(),
    });
  },
);
