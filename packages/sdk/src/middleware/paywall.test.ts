import { describe, it, expect, vi } from 'vitest';
import { createPaywallMiddleware } from './paywall.js';
import {
  DEFAULTS,
  HTTP_402,
  USDC_DECIMALS,
  X402_HEADER,
  PAYMENT_REQUIRED_HEADER,
} from '../constants.js';

describe('createPaywallMiddleware', () => {
  const sellerAddress = '0x1111111111111111111111111111111111111111' as const;
  const buyerAddress = '0x2222222222222222222222222222222222222222' as const;

  it('throws if no seller address configured', () => {
    const originalEnv = process.env.SELLER_ADDRESS;
    delete process.env.SELLER_ADDRESS;
    expect(() => createPaywallMiddleware({ price: '0.001' })).toThrow(/Seller address is required/);
    process.env.SELLER_ADDRESS = originalEnv;
  });

  describe('getPaymentRequirements', () => {
    it('returns correct structure with price, network, payTo, expiry', () => {
      const paywall = createPaywallMiddleware({
        price: '0.005',
        payTo: sellerAddress,
        network: 'arc-testnet',
      });
      const req = paywall.getPaymentRequirements();

      expect(req.maxAmountRequired).toBe('0.005');
      expect(req.payTo).toBe(sellerAddress);
      expect(req.network).toBe('arc-testnet');
      expect(req.x402Version).toBe(2);
      expect(req.scheme).toBe('exact');
      expect(req.expiry).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('parsePayment', () => {
    const paywall = createPaywallMiddleware({ price: '0.001', payTo: sellerAddress });

    it('returns null for missing header', () => {
      expect(paywall.parsePayment({})).toBeNull();
    });

    it('returns null for malformed base64', () => {
      expect(paywall.parsePayment({ [X402_HEADER]: 'not-base64!' })).toBeNull();
    });

    it('decodes valid base64 X-PAYMENT header', () => {
      const payload = { test: 'payload' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const parsed = paywall.parsePayment({ [X402_HEADER]: encoded });
      expect(parsed).toEqual(payload);
    });
  });

  describe('verifyPayment', () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const paywall = createPaywallMiddleware({ price: '0.001', payTo: sellerAddress, logger });

    const createPayload = (overrides: any = {}) =>
      ({
        payload: {
          signature: '0xabc',
          authorization: {
            from: buyerAddress,
            to: sellerAddress,
            value: '1000', // 0.001 USDC
            validBefore: Math.floor(Date.now() / 1000) + 3600,
            ...overrides,
          },
        },
      }) as any;

    it('fails closed when no trusted verifier is configured', async () => {
      expect(await paywall.verifyPayment(createPayload())).toBe(false);
      expect(await paywall.verifyPayment(createPayload({ value: '999999999' }))).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('not configured'));
    });

    it('uses custom verifyPayment if provided', async () => {
      const customVerify = vi.fn().mockResolvedValue({ success: true });
      const customPaywall = createPaywallMiddleware({
        price: '0.001',
        payTo: sellerAddress,
        verifyPayment: customVerify,
      });
      const payload = createPayload();

      expect(await customPaywall.verifyPayment(payload)).toBe(true);
      expect(customVerify).toHaveBeenCalledWith(payload);
    });
  });
});
