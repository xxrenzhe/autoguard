export * from './crypto';
export declare function generateSubdomain(): string;
export declare function generateToken(): string;
/**
 * 生成域名验证 Token
 */
export declare function generateDomainVerificationToken(): string;
/**
 * 验证 IP 地址格式
 */
export declare function isValidIPv4(ip: string): boolean;
/**
 * 验证 IPv6 地址格式
 */
export declare function isValidIPv6(ip: string): boolean;
/**
 * 验证 IP 地址格式（IPv4/IPv6）
 */
export declare function isValidIP(ip: string): boolean;
/**
 * 验证 CIDR 格式
 */
export declare function isValidCIDR(cidr: string): boolean;
/**
 * 检查 IP 是否在 CIDR 范围内
 */
export declare function ipInCIDR(ip: string, cidr: string): boolean;
/**
 * 验证域名格式
 */
export declare function isValidDomain(domain: string): boolean;
/**
 * 验证 URL 格式
 */
export declare function isValidUrl(url: string): boolean;
/**
 * 提取域名（不含协议和路径）
 */
export declare function extractDomain(url: string): string | null;
/**
 * 格式化日期为 YYYY-MM-DD
 */
export declare function formatDate(date?: Date): string;
/**
 * 睡眠函数
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * 重试函数
 */
export declare function retry<T>(fn: () => Promise<T>, options?: {
    maxRetries?: number;
    delay?: number;
    backoff?: number;
}): Promise<T>;
/**
 * 安全的 JSON 解析
 */
export declare function safeJsonParse<T>(json: string, defaultValue: T): T;
/**
 * 截断字符串
 */
export declare function truncate(str: string, maxLength: number): string;
/**
 * 移除对象中的 undefined 值
 */
export declare function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T>;
//# sourceMappingURL=index.d.ts.map
