import { describe, it, expect } from 'vitest';
import { withRetry, withTimeout, ReviewError, ErrorCodes } from '../src/utils/error-handler';
import { RateLimiter, DEFAULT_RATE_LIMITS } from '../src/utils/rate-limiter';

describe('withRetry', () => {
  it('should return the result on first success without retrying', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      return 'success';
    };

    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient failure');
      return 'success';
    };

    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should throw ReviewError with RETRY_EXHAUSTED after all retries fail', async () => {
    const fn = async () => {
      throw new Error('always fails');
    };

    await expect(withRetry(fn, 2, 10)).rejects.toThrow(ReviewError);

    try {
      await withRetry(fn, 2, 10);
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewError);
      expect((error as ReviewError).code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    }
  });
});

describe('withTimeout', () => {
  it('should return the result if the function completes before timeout', async () => {
    const fn = async () => {
      return 'done';
    };

    const result = await withTimeout(fn, 1000);
    expect(result).toBe('done');
  });

  it('should throw ReviewError with AGENT_TIMEOUT if the function exceeds timeout', async () => {
    const slowFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'too slow';
    };

    await expect(withTimeout(slowFn, 50)).rejects.toThrow(ReviewError);

    try {
      await withTimeout(slowFn, 50);
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewError);
      expect((error as ReviewError).code).toBe(ErrorCodes.AGENT_TIMEOUT);
    }
  });
});

describe('RateLimiter', () => {
  it('should initialize with default limits', () => {
    const limiter = new RateLimiter(DEFAULT_RATE_LIMITS);
    const status = limiter.getStatus();
    expect(status).toBeDefined();
  });

  it('should allow a request within limits via canProceed', () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 10,
      maxTokensPerMinute: 10000,
      maxConcurrent: 5
    });

    expect(limiter.canProceed(100)).toBe(true);
  });

  it('should track active requests after acquire and release', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 100000,
      maxConcurrent: 5
    });

    await limiter.acquire(100);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release(100);
    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('should respect maxConcurrent by blocking canProceed when limit reached', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 100000,
      maxConcurrent: 1
    });

    await limiter.acquire(100);
    expect(limiter.canProceed(100)).toBe(false);

    limiter.release(100);
    expect(limiter.canProceed(100)).toBe(true);
  });
});
