/**
 * Redis-based Rate Limiting Utility
 * Implements sliding window algorithm
 *
 * Note: This must be used in API routes (server components),
 * not in middleware which runs in Edge runtime.
 */

import { getRedis } from '@autoguard/shared';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowSeconds: number;
  limit: number;
}

/**
 * Default rate limits
 */
export const defaultRateLimits = {
  api: { windowSeconds: 60, limit: 60 }, // 60 requests per minute
  auth: { windowSeconds: 60, limit: 10 }, // 10 auth attempts per minute
  offers: { windowSeconds: 60, limit: 30 }, // 30 offer operations per minute
  blacklist: { windowSeconds: 60, limit: 20 }, // 20 blacklist operations per minute
  upload: { windowSeconds: 300, limit: 10 }, // 10 uploads per 5 minutes
} as const;

/**
 * Check rate limit using sliding window algorithm
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
  const redisKey = `autoguard:ratelimit:${key}`;

  try {
    // Use a sorted set to track requests with timestamps as scores
    const pipeline = redis.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(redisKey, 0, windowStart);

    // Count current entries
    pipeline.zcard(redisKey);

    // Add current request (but don't commit yet - we'll do this separately if allowed)
    const results = await pipeline.exec();

    if (!results) {
      // Redis error, allow request
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: now + config.windowSeconds * 1000,
        limit: config.limit,
      };
    }

    const currentCount = results[1]?.[1] as number || 0;
    const remaining = Math.max(0, config.limit - currentCount - 1);
    const resetAt = now + config.windowSeconds * 1000;

    if (currentCount >= config.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: config.limit,
      };
    }

    // Add this request to the window
    await redis.zadd(redisKey, now, `${now}:${Math.random()}`);

    // Set expiry on the key
    await redis.expire(redisKey, config.windowSeconds + 1);

    return {
      allowed: true,
      remaining,
      resetAt,
      limit: config.limit,
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow the request
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: now + config.windowSeconds * 1000,
      limit: config.limit,
    };
  }
}

/**
 * Get rate limit key for user/IP combination
 */
export function getRateLimitKey(
  userId: number | null,
  ip: string,
  action: string
): string {
  if (userId) {
    return `user:${userId}:${action}`;
  }
  return `ip:${ip}:${action}`;
}

/**
 * Rate limit response helper
 */
export function rateLimitExceededResponse(result: RateLimitResult) {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
        'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
      },
    }
  );
}

/**
 * Helper to apply rate limiting in API routes
 */
export async function withRateLimit(
  request: Request,
  userId: number | null,
  action: string,
  config: RateLimitConfig = defaultRateLimits.api
): Promise<RateLimitResult> {
  // Get IP from headers
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const key = getRateLimitKey(userId, ip, action);
  return checkRateLimit(key, config);
}
