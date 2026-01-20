/**
 * Blacklist Sync Service
 * 同步黑名单数据从 SQLite 到 Redis
 * 支持全量同步和增量同步
 */
/**
 * 同步所有黑名单数据到 Redis
 */
export declare function syncAllBlacklists(): Promise<{
    ips: number;
    ipRanges: number;
    uas: number;
    isps: number;
    geos: number;
}>;
/**
 * 同步 IP 黑名单
 */
export declare function syncIPBlacklist(): Promise<number>;
/**
 * 同步 IP 范围（CIDR）黑名单
 */
export declare function syncIPRangeBlacklist(): Promise<number>;
/**
 * 同步 UA 黑名单
 */
export declare function syncUABlacklist(): Promise<number>;
/**
 * 同步 ISP/ASN 黑名单
 */
export declare function syncISPBlacklist(): Promise<number>;
/**
 * 同步 Geo 黑名单
 */
export declare function syncGeoBlacklist(): Promise<number>;
/**
 * 清理过期的黑名单条目
 */
export declare function cleanupExpiredBlacklists(): Promise<{
    ips: number;
    ipRanges: number;
}>;
/**
 * 添加单个 IP 到黑名单并同步到 Redis
 */
export declare function addIPToBlacklist(ip: string, userId: number | null, reason?: string, source?: string, expiresAt?: string): Promise<void>;
/**
 * 从黑名单移除单个 IP 并同步到 Redis
 */
export declare function removeIPFromBlacklist(ip: string, userId: number | null): Promise<void>;
//# sourceMappingURL=blacklist-sync.d.ts.map