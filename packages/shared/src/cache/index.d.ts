import Redis from 'ioredis';
/**
 * 获取 Redis 实例（单例）
 */
export declare function getRedis(): Redis;
/**
 * 关闭 Redis 连接
 */
export declare function closeRedis(): Promise<void>;
/**
 * Redis Key 命名规范
 * 所有 Key 必须带 autoguard: 前缀
 */
export declare const CacheKeys: {
    readonly offer: {
        readonly byId: (id: number) => string;
        readonly bySubdomain: (subdomain: string) => string;
        readonly byDomain: (domain: string) => string;
    };
    readonly page: {
        readonly content: (offerId: number, type: "money" | "safe") => string;
    };
    readonly blacklist: {
        readonly ip: (scope: "global" | number) => string;
        readonly ipRanges: (scope: "global" | number) => string;
        readonly isps: (scope: "global" | number) => string;
        readonly uas: (scope: "global" | number) => string;
        readonly geos: (scope: "global" | number) => string;
    };
    readonly geoip: (ip: string) => string;
    readonly stats: {
        readonly cloak: (date: string) => string;
    };
    readonly rateLimit: (userId: number, action: string) => string;
    readonly queue: {
        readonly cloakLogs: "queue:cloak_logs";
        readonly pageGeneration: "queue:page_generation";
        readonly scrapeJobs: "queue:scrape_jobs";
    };
};
/**
 * 缓存 TTL 配置（秒）
 */
export declare const CacheTTL: {
    readonly offer: 300;
    readonly page: 3600;
    readonly geoip: 300;
    readonly stats: 604800;
};
/**
 * 设置缓存（带 TTL）
 */
export declare function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
/**
 * 获取缓存
 */
export declare function getCache<T>(key: string): Promise<T | null>;
/**
 * 删除缓存
 */
export declare function deleteCache(...keys: string[]): Promise<void>;
/**
 * 检查缓存是否存在
 */
export declare function cacheExists(key: string): Promise<boolean>;
/**
 * 推送到列表（左侧）
 */
export declare function listPush(key: string, ...values: string[]): Promise<void>;
/**
 * 从列表弹出（右侧）
 */
export declare function listPop(key: string): Promise<string | null>;
/**
 * 批量从列表弹出
 */
export declare function listPopBatch(key: string, count: number): Promise<string[]>;
/**
 * 添加到集合
 */
export declare function setAdd(key: string, ...members: string[]): Promise<void>;
/**
 * 检查是否在集合中
 */
export declare function setIsMember(key: string, member: string): Promise<boolean>;
/**
 * 获取集合所有成员
 */
export declare function setMembers(key: string): Promise<string[]>;
export { Redis };
//# sourceMappingURL=index.d.ts.map