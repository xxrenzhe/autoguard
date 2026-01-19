import Redis from 'ioredis';

let redis: Redis | null = null;

/**
 * 获取 Redis 实例（单例）
 */
export function getRedis(): Redis {
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    enableReadyCheck: true,
    connectTimeout: 10000,
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });

  return redis;
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Redis Key 命名规范
 * 所有 Key 必须带 autoguard: 前缀
 */
export const CacheKeys = {
  // Offer 缓存
  offer: {
    byId: (id: number) => `autoguard:offer:id:${id}`,
    bySubdomain: (subdomain: string) => `autoguard:offer:subdomain:${subdomain}`,
    byDomain: (domain: string) => `autoguard:offer:domain:${domain}`,
  },

  // 页面缓存
  page: {
    content: (offerId: number, type: 'money' | 'safe') =>
      `autoguard:page:${offerId}:${type}`,
  },

  // 黑名单缓存
  blacklist: {
    ip: (scope: 'global' | number) =>
      scope === 'global'
        ? 'autoguard:blacklist:ip:global'
        : `autoguard:blacklist:ip:user:${scope}`,
    ipRanges: (scope: 'global' | number) =>
      scope === 'global'
        ? 'autoguard:blacklist:ip_ranges:global'
        : `autoguard:blacklist:ip_ranges:user:${scope}`,
    isps: (scope: 'global' | number) =>
      scope === 'global'
        ? 'autoguard:blacklist:isps:global'
        : `autoguard:blacklist:isps:user:${scope}`,
    uas: (scope: 'global' | number) =>
      scope === 'global'
        ? 'autoguard:blacklist:uas:global'
        : `autoguard:blacklist:uas:user:${scope}`,
    geos: (scope: 'global' | number) =>
      scope === 'global'
        ? 'autoguard:blacklist:geos:global'
        : `autoguard:blacklist:geos:user:${scope}`,
  },

  // GeoIP 缓存
  geoip: (ip: string) => `autoguard:geoip:${ip}`,

  // 统计缓存
  stats: {
    cloak: (date: string) => `autoguard:stats:cloak:${date}`,
  },

  // 速率限制
  rateLimit: (userId: number, action: string) =>
    `autoguard:ratelimit:${userId}:${action}`,

  // 队列
  queue: {
    cloakLogs: 'queue:cloak_logs',
    pageGeneration: 'queue:page_generation',
    scrapeJobs: 'queue:scrape_jobs',
  },
} as const;

/**
 * 缓存 TTL 配置（秒）
 */
export const CacheTTL = {
  offer: 300, // 5 分钟
  page: 3600, // 1 小时
  geoip: 300, // 5 分钟
  stats: 604800, // 7 天
} as const;

/**
 * 设置缓存（带 TTL）
 */
export async function setCache(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  const client = getRedis();
  const serialized = JSON.stringify(value);

  if (ttlSeconds) {
    await client.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await client.set(key, serialized);
  }
}

/**
 * 获取缓存
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const client = getRedis();
  const value = await client.get(key);

  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * 删除缓存
 */
export async function deleteCache(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const client = getRedis();
  await client.del(...keys);
}

/**
 * 检查缓存是否存在
 */
export async function cacheExists(key: string): Promise<boolean> {
  const client = getRedis();
  return (await client.exists(key)) === 1;
}

/**
 * 推送到列表（左侧）
 */
export async function listPush(key: string, ...values: string[]): Promise<void> {
  const client = getRedis();
  await client.lpush(key, ...values);
}

/**
 * 从列表弹出（右侧）
 */
export async function listPop(key: string): Promise<string | null> {
  const client = getRedis();
  return client.rpop(key);
}

/**
 * 批量从列表弹出
 */
export async function listPopBatch(key: string, count: number): Promise<string[]> {
  const client = getRedis();
  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    const value = await client.rpop(key);
    if (!value) break;
    results.push(value);
  }

  return results;
}

/**
 * 添加到集合
 */
export async function setAdd(key: string, ...members: string[]): Promise<void> {
  const client = getRedis();
  await client.sadd(key, ...members);
}

/**
 * 检查是否在集合中
 */
export async function setIsMember(key: string, member: string): Promise<boolean> {
  const client = getRedis();
  return (await client.sismember(key, member)) === 1;
}

/**
 * 获取集合所有成员
 */
export async function setMembers(key: string): Promise<string[]> {
  const client = getRedis();
  return client.smembers(key);
}

export { Redis };
