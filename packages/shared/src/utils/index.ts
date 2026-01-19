import { customAlphabet } from 'nanoid';

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
 * 验证 CIDR 格式
 */
export function isValidCIDR(cidr: string): boolean {
  const pattern = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!pattern.test(cidr)) return false;

  const [ip, prefixStr] = cidr.split('/');
  if (!ip || !prefixStr) return false;

  if (!isValidIPv4(ip)) return false;

  const prefix = parseInt(prefixStr, 10);
  return prefix >= 0 && prefix <= 32;
}

/**
 * 检查 IP 是否在 CIDR 范围内
 */
export function ipInCIDR(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split('/');
  if (!cidrIp || !prefixStr) return false;

  const prefix = parseInt(prefixStr, 10);
  const ipNum = ipToNumber(ip);
  const cidrNum = ipToNumber(cidrIp);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;

  return (ipNum & mask) === (cidrNum & mask);
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
