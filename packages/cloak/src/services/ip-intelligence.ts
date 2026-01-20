/**
 * IP 情报服务
 * 使用 MaxMind 数据库进行 IP 查询
 */

import maxmind, { CityResponse, AsnResponse, Reader as MaxmindReader } from 'maxmind';
import { LRUCache } from 'lru-cache';
import { getRedis, CacheKeys, CacheTTL } from '@autoguard/shared';
import type { IPLookupResult } from '../types';
import path from 'path';
import fs from 'fs';

// Anonymous IP 数据库类型定义 (GeoIP2-Anonymous-IP.mmdb)
interface AnonymousIPResponse {
  is_anonymous?: boolean;
  is_anonymous_vpn?: boolean;
  is_hosting_provider?: boolean;
  is_public_proxy?: boolean;
  is_residential_proxy?: boolean;
  is_tor_exit_node?: boolean;
}

// 内存缓存（LRU）
const memoryCache = new LRUCache<string, IPLookupResult>({
  max: 10000,
  ttl: 1000 * 60 * 5, // 5 分钟
});

// MaxMind Reader 实例
let cityReader: MaxmindReader<CityResponse> | null = null;
let asnReader: MaxmindReader<AsnResponse> | null = null;
let anonymousReader: MaxmindReader<AnonymousIPResponse> | null = null;
let initialized = false;

/**
 * 初始化 MaxMind 数据库
 */
export async function initMaxMind(): Promise<void> {
  if (initialized) return;

  // Support both MAXMIND_DB_PATH (directory) and GEOIP_DB_PATH/GEOIP_ASN_DB_PATH (individual files)
  // docker-compose uses GEOIP_DB_PATH/GEOIP_ASN_DB_PATH
  const maxmindDir = process.env.MAXMIND_DB_PATH || '/data/maxmind';

  const cityDbPath = process.env.GEOIP_DB_PATH || path.join(maxmindDir, 'GeoLite2-City.mmdb');
  const asnDbPath = process.env.GEOIP_ASN_DB_PATH || path.join(maxmindDir, 'GeoLite2-ASN.mmdb');
  const anonymousDbPath = process.env.GEOIP_ANONYMOUS_DB_PATH || path.join(maxmindDir, 'GeoIP2-Anonymous-IP.mmdb');

  try {
    if (fs.existsSync(cityDbPath)) {
      cityReader = await maxmind.open<CityResponse>(cityDbPath);
      console.log('MaxMind City database loaded');
    } else {
      console.warn(`MaxMind City database not found: ${cityDbPath}`);
    }

    if (fs.existsSync(asnDbPath)) {
      asnReader = await maxmind.open<AsnResponse>(asnDbPath);
      console.log('MaxMind ASN database loaded');
    } else {
      console.warn(`MaxMind ASN database not found: ${asnDbPath}`);
    }

    // Load Anonymous IP database for VPN/Proxy/Tor detection (GeoIP2 商业版或 GeoLite2)
    if (fs.existsSync(anonymousDbPath)) {
      anonymousReader = await maxmind.open<AnonymousIPResponse>(anonymousDbPath);
      console.log('MaxMind Anonymous-IP database loaded (VPN/Proxy/Tor detection enabled)');
    } else {
      console.warn(`MaxMind Anonymous-IP database not found: ${anonymousDbPath} (VPN/Proxy/Tor detection will use heuristics only)`);
    }

    initialized = true;
  } catch (error) {
    console.error('Failed to initialize MaxMind:', error);
  }
}

/**
 * 获取 IP 情报
 */
export async function getIPIntelligence(ip: string): Promise<IPLookupResult> {
  // 1. 检查内存缓存
  const cached = memoryCache.get(ip);
  if (cached) {
    return cached;
  }

  // 2. 检查 Redis 缓存
  try {
    const redis = getRedis();
    const redisKey = CacheKeys.geoip(ip);
    const redisCached = await redis.get(redisKey);
    if (redisCached) {
      const result = JSON.parse(redisCached) as IPLookupResult;
      memoryCache.set(ip, result);
      return result;
    }
  } catch (error) {
    // Redis 不可用时继续查询
    console.warn('Redis cache error:', error);
  }

  // 3. 查询 MaxMind
  const result = await lookupIP(ip);

  // 4. 写入缓存
  memoryCache.set(ip, result);
  try {
    const redis = getRedis();
    const redisKey = CacheKeys.geoip(ip);
    await redis.set(redisKey, JSON.stringify(result), 'EX', CacheTTL.geoip);
  } catch {
    // 忽略缓存写入错误
  }

  return result;
}

/**
 * 使用 MaxMind 查询 IP
 */
async function lookupIP(ip: string): Promise<IPLookupResult> {
  // 确保初始化
  if (!initialized) {
    await initMaxMind();
  }

  const result: IPLookupResult = {
    isDatacenter: false,
    isVPN: false,
    isProxy: false,
    isTor: false,
    isResidential: true,
    isHosting: false,
  };

  // 查询 City 数据库
  if (cityReader) {
    try {
      const cityResponse = cityReader.get(ip);
      if (cityResponse) {
        result.country = cityResponse.country?.iso_code;
        result.countryName = cityResponse.country?.names?.en;
        result.region = cityResponse.subdivisions?.[0]?.iso_code;
        result.city = cityResponse.city?.names?.en;
        result.timezone = cityResponse.location?.time_zone;
        result.latitude = cityResponse.location?.latitude;
        result.longitude = cityResponse.location?.longitude;
      }
    } catch (error) {
      // IP 查询失败（可能是无效 IP）
      console.warn(`City lookup failed for ${ip}:`, error);
    }
  }

  // 查询 ASN 数据库
  if (asnReader) {
    try {
      const asnResponse = asnReader.get(ip);
      if (asnResponse) {
        result.asn = `AS${asnResponse.autonomous_system_number}`;
        result.org = asnResponse.autonomous_system_organization;
        result.isp = asnResponse.autonomous_system_organization;

        // 根据 ASN 组织名称推断连接类型
        const orgLower = (result.org || '').toLowerCase();
        result.connectionType = inferConnectionType(orgLower);
        result.isDatacenter =
          result.connectionType === 'datacenter' || isKnownDatacenter(orgLower);
        result.isHosting = isKnownHosting(orgLower);
        result.isResidential = result.connectionType === 'residential';
      }
    } catch (error) {
      console.warn(`ASN lookup failed for ${ip}:`, error);
    }
  }

  // 查询 Anonymous IP 数据库 (VPN/Proxy/Tor 检测)
  if (anonymousReader) {
    try {
      const anonResponse = anonymousReader.get(ip);
      if (anonResponse) {
        // 直接使用 MaxMind 的 VPN/Proxy/Tor 检测结果
        if (anonResponse.is_anonymous_vpn) {
          result.isVPN = true;
          result.isResidential = false;
        }
        if (anonResponse.is_public_proxy || anonResponse.is_residential_proxy) {
          result.isProxy = true;
          result.isResidential = false;
        }
        if (anonResponse.is_tor_exit_node) {
          result.isTor = true;
          result.isResidential = false;
        }
        if (anonResponse.is_hosting_provider) {
          result.isHosting = true;
          result.isDatacenter = true;
          result.isResidential = false;
        }
      }
    } catch (error) {
      console.warn(`Anonymous IP lookup failed for ${ip}:`, error);
    }
  }

  return result;
}

/**
 * 推断连接类型
 */
function inferConnectionType(
  org: string
): 'residential' | 'business' | 'datacenter' | 'mobile' | 'unknown' {
  // 移动运营商
  if (
    org.includes('mobile') ||
    org.includes('wireless') ||
    org.includes('cellular') ||
    org.includes('4g') ||
    org.includes('5g') ||
    org.includes('lte')
  ) {
    return 'mobile';
  }

  // 数据中心/云服务商
  if (
    org.includes('amazon') ||
    org.includes('aws') ||
    org.includes('google') ||
    org.includes('microsoft') ||
    org.includes('azure') ||
    org.includes('digitalocean') ||
    org.includes('vultr') ||
    org.includes('linode') ||
    org.includes('ovh') ||
    org.includes('hetzner') ||
    org.includes('cloudflare') ||
    org.includes('hosting') ||
    org.includes('server') ||
    org.includes('datacenter') ||
    org.includes('data center') ||
    org.includes('cloud')
  ) {
    return 'datacenter';
  }

  // ISP（通常是住宅）
  if (
    org.includes('comcast') ||
    org.includes('verizon') ||
    org.includes('at&t') ||
    org.includes('spectrum') ||
    org.includes('cox') ||
    org.includes('charter') ||
    org.includes('centurylink') ||
    org.includes('frontier') ||
    org.includes('telecom') ||
    org.includes('broadband') ||
    org.includes('isp') ||
    org.includes('internet service')
  ) {
    return 'residential';
  }

  return 'unknown';
}

/**
 * 检查是否为已知数据中心
 */
function isKnownDatacenter(org: string): boolean {
  const datacenterKeywords = [
    'amazon',
    'aws',
    'google cloud',
    'gcp',
    'microsoft',
    'azure',
    'digitalocean',
    'vultr',
    'linode',
    'ovh',
    'hetzner',
    'rackspace',
    'softlayer',
    'ibm cloud',
    'oracle cloud',
    'alibaba cloud',
    'tencent cloud',
    'scaleway',
    'upcloud',
    'choopa',
    'colocrossing',
    'quadranet',
  ];

  return datacenterKeywords.some((keyword) => org.includes(keyword));
}

/**
 * 检查是否为已知托管服务
 */
function isKnownHosting(org: string): boolean {
  const hostingKeywords = [
    'hosting',
    'hostinger',
    'godaddy',
    'bluehost',
    'siteground',
    'namecheap',
    'dreamhost',
    'inmotionhosting',
    'a2 hosting',
    'hostgator',
    'liquidweb',
    'webhosting',
    'vps',
    'dedicated server',
  ];

  return hostingKeywords.some((keyword) => org.includes(keyword));
}

/**
 * 关闭 MaxMind 读取器
 */
export function closeMaxMind(): void {
  // MaxMind reader 不需要显式关闭
  cityReader = null;
  asnReader = null;
  anonymousReader = null;
  initialized = false;
}
