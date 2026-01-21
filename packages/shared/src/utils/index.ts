import { customAlphabet } from 'nanoid';
import net from 'net';

// 导出 crypto 工具
export * from './crypto';

/**
 * 生成 6 位随机子域名
 */
const nanoidSubdomain = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export function generateSubdomain(): string {
  return nanoidSubdomain();
}

/**
 * 生成唯一 Token
 */
const nanoidToken = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  32
);

export function generateToken(): string {
  return nanoidToken();
}

/**
 * 生成域名验证 Token
 */
export function generateDomainVerificationToken(): string {
  return `ag-verify=${generateToken()}`;
}

/**
 * 验证 IP 地址格式
 */
export function isValidIPv4(ip: string): boolean {
  const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!pattern.test(ip)) return false;

  const parts = ip.split('.');
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * 验证 IPv6 地址格式
 */
export function isValidIPv6(ip: string): boolean {
  return net.isIPv6(ip);
}

/**
 * 验证 IP 地址格式（IPv4/IPv6）
 */
export function isValidIP(ip: string): boolean {
  return net.isIP(ip) !== 0;
}

/**
 * 验证 CIDR 格式
 */
export function isValidCIDR(cidr: string): boolean {
  const [ip, prefixStr] = cidr.split('/');
  if (!ip || !prefixStr) return false;

  if (!/^\d+$/.test(prefixStr)) return false;
  const prefix = Number(prefixStr);

  const version = net.isIP(ip);
  if (version === 4) {
    return prefix >= 0 && prefix <= 32;
  }

  if (version === 6) {
    return prefix >= 0 && prefix <= 128;
  }

  return false;
}

/**
 * 检查 IP 是否在 CIDR 范围内
 */
export function ipInCIDR(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split('/');
  if (!cidrIp || !prefixStr) return false;

  if (!/^\d+$/.test(prefixStr)) return false;
  const prefix = Number(prefixStr);

  const ipVersion = net.isIP(ip);
  const cidrVersion = net.isIP(cidrIp);
  if (ipVersion === 0 || cidrVersion === 0 || ipVersion !== cidrVersion) return false;

  if (ipVersion === 4) {
    if (prefix < 0 || prefix > 32) return false;
    const ipNum = ipToNumber(ip);
    const cidrNum = ipToNumber(cidrIp);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (cidrNum & mask);
  }

  if (prefix < 0 || prefix > 128) return false;

  try {
    const ipNum = ipv6ToBigInt(ip);
    const cidrNum = ipv6ToBigInt(cidrIp);
    const mask =
      prefix === 0
        ? 0n
        : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return (ipNum & mask) === (cidrNum & mask);
  } catch {
    return false;
  }
}

/**
 * IP 地址转数字
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  return (
    ((parseInt(parts[0]!, 10) << 24) |
      (parseInt(parts[1]!, 10) << 16) |
      (parseInt(parts[2]!, 10) << 8) |
      parseInt(parts[3]!, 10)) >>>
    0
  );
}

function ipv6ToBigInt(rawIp: string): bigint {
  let ip = rawIp;
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    ip = ip.slice(0, zoneIndex);
  }

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.0.1)
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    const ipv4Part = ip.slice(lastColon + 1);
    const ipv4Num = ipToNumber(ipv4Part);
    const high = ((ipv4Num >>> 16) & 0xffff).toString(16);
    const low = (ipv4Num & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon)}:${high}:${low}`;
  }

  const doubleColonIndex = ip.indexOf('::');
  let groups: string[];

  if (doubleColonIndex !== -1) {
    const parts = ip.split('::');
    if (parts.length !== 2) {
      throw new Error('Invalid IPv6 format');
    }
    const [left, right] = parts;
    const leftGroups = left ? left.split(':').filter(Boolean) : [];
    const rightGroups = right ? right.split(':').filter(Boolean) : [];
    const missing = 8 - (leftGroups.length + rightGroups.length);
    if (missing < 0) {
      throw new Error('Invalid IPv6 format');
    }
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = ip.split(':').filter(Boolean);
  }

  if (groups.length !== 8) {
    throw new Error('Invalid IPv6 format');
  }

  let result = 0n;
  for (const group of groups) {
    const value = parseInt(group, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) {
      throw new Error('Invalid IPv6 group');
    }
    result = (result << 16n) + BigInt(value);
  }

  return result;
}

/**
 * 验证域名格式
 */
export function isValidDomain(domain: string): boolean {
  const pattern =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return pattern.test(domain);
}

/**
 * 验证 URL 格式
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 提取域名（不含协议和路径）
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]!;
}

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    backoff?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        await sleep(delay * Math.pow(backoff, attempt));
      }
    }
  }

  throw lastError;
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * 移除对象中的 undefined 值
 */
export function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}
