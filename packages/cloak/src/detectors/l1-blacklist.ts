/**
 * L1 - 静态黑名单检测器
 * 检查 IP/UA/ISP/Geo 是否在黑名单中
 * 这是优先级最高的检测层，命中任何黑名单直接转到 Safe Page
 */

import { getRedis, CacheKeys } from '@autoguard/shared';
import type {
  Detector,
  CloakRequest,
  DetectionContext,
  DetectorResult,
  L1Details,
} from '../types';
import { ipInCIDR } from '@autoguard/shared';
import { getIPIntelligence } from '../services/ip-intelligence';

export class L1BlacklistDetector implements Detector {
  name = 'L1-Blacklist';
  layer = 'L1' as const;

  async detect(
    request: CloakRequest,
    context: DetectionContext
  ): Promise<DetectorResult> {
    const details: L1Details = {
      passed: true,
      ipBlocked: false,
      uaBlocked: false,
      ispBlocked: false,
      geoBlocked: false,
    };

    // 1. 检查 IP 黑名单（精确匹配 + CIDR）
    const ipMatch = await this.checkIPBlacklist(request.ip, context.userId);
    if (ipMatch) {
      details.passed = false;
      details.ipBlocked = true;
      details.blockedType = ipMatch.type;
      details.blockedValue = ipMatch.value;
      details.blockedScope = ipMatch.scope;
      details.blockedReason =
        ipMatch.type === 'ip'
          ? `IP in blacklist: ${ipMatch.value}`
          : `IP in CIDR blacklist: ${ipMatch.value}`;
      return {
        passed: false,
        score: 0,
        reason:
          ipMatch.type === 'ip'
            ? `IP blocked by L1 blacklist: ${ipMatch.value}`
            : `IP range blocked by L1 blacklist: ${ipMatch.value}`,
        details,
      };
    }

    // 2. 检查 UA 黑名单
    const uaMatch = await this.checkUABlacklist(request.userAgent, context.userId);
    if (uaMatch) {
      details.passed = false;
      details.uaBlocked = true;
      details.blockedType = 'ua';
      details.blockedValue = uaMatch.pattern;
      details.blockedScope = uaMatch.scope;
      details.blockedPatternType = uaMatch.patternType;
      details.blockedReason = `User-Agent pattern matched: ${uaMatch.pattern}`;
      return {
        passed: false,
        score: 0,
        reason: `UA blocked by L1 blacklist: ${uaMatch.pattern}`,
        details,
      };
    }

    // 3. 获取 IP 信息用于 ISP 和 Geo 检查
    const ipInfo = await getIPIntelligence(request.ip);

    // 4. 检查 ISP/ASN 黑名单
    if (ipInfo.asn) {
      const ispMatch = await this.checkISPBlacklist(ipInfo.asn, ipInfo.org, context.userId);
      if (ispMatch) {
        details.passed = false;
        details.ispBlocked = true;
        details.blockedType = 'isp';
        details.blockedValue = ispMatch.value;
        details.blockedScope = ispMatch.scope;
        details.blockedReason = `ISP/ASN blocked: ${ispMatch.value}`;
        return {
          passed: false,
          score: 0,
          reason: `ISP/ASN blocked by L1 blacklist: ${ispMatch.value}`,
          details,
        };
      }
    }

    // 5. 检查 Geo 黑名单
    if (ipInfo.country) {
      const geoMatch = await this.checkGeoBlacklist(
        ipInfo.country,
        ipInfo.region,
        context.userId
      );
      if (geoMatch) {
        details.passed = false;
        details.geoBlocked = true;
        details.blockedType = 'geo';
        details.blockedValue = geoMatch.value;
        details.blockedScope = geoMatch.scope;
        details.blockedReason = `Geo blocked: ${geoMatch.value}`;
        return {
          passed: false,
          score: 0,
          reason: `Geo blocked by L1 blacklist: ${geoMatch.value}`,
          details,
        };
      }
    }

    return {
      passed: true,
      score: 100,
      details,
    };
  }

  /**
   * 检查 IP 是否在黑名单中
   */
  private async checkIPBlacklist(
    ip: string,
    userId: number
  ): Promise<{ type: 'ip' | 'ip_range'; value: string; scope: 'global' | 'user' } | null> {
    const redis = getRedis();

    // 检查全局 IP 黑名单（精确匹配）
    const globalKey = CacheKeys.blacklist.ip('global');
    if (await redis.sismember(globalKey, ip)) {
      return { type: 'ip', value: ip, scope: 'global' };
    }

    // 检查用户 IP 黑名单（精确匹配）
    const userKey = CacheKeys.blacklist.ip(userId);
    if (await redis.sismember(userKey, ip)) {
      return { type: 'ip', value: ip, scope: 'user' };
    }

    // 检查 CIDR 范围
    const globalRanges = await this.getCIDRRanges('global');
    for (const cidr of globalRanges) {
      if (ipInCIDR(ip, cidr)) {
        return { type: 'ip_range', value: cidr, scope: 'global' };
      }
    }

    const userRanges = await this.getCIDRRanges(userId);
    for (const cidr of userRanges) {
      if (ipInCIDR(ip, cidr)) {
        return { type: 'ip_range', value: cidr, scope: 'user' };
      }
    }

    return null;
  }

  /**
   * 获取 CIDR 范围列表
   */
  private async getCIDRRanges(scope: 'global' | number): Promise<string[]> {
    const redis = getRedis();
    const key = CacheKeys.blacklist.ipRanges(scope);
    const data = await redis.get(key);
    if (!data) return [];

    try {
      return JSON.parse(data) as string[];
    } catch {
      return [];
    }
  }

  /**
   * 检查 UA 是否在黑名单中
   */
  private async checkUABlacklist(
    ua: string,
    userId: number
  ): Promise<
    | { pattern: string; patternType: 'exact' | 'contains' | 'regex'; scope: 'global' | 'user' }
    | null
  > {
    const redis = getRedis();
    const uaLower = ua.toLowerCase();

    // 获取全局 UA 模式
    const globalKey = CacheKeys.blacklist.uas('global');
    const globalPatterns = await redis.lrange(globalKey, 0, -1);

    for (const pattern of globalPatterns) {
      const match = this.matchUAPattern(uaLower, pattern);
      if (match) return { ...match, scope: 'global' };
    }

    // 获取用户 UA 模式
    const userKey = CacheKeys.blacklist.uas(userId);
    const userPatterns = await redis.lrange(userKey, 0, -1);

    for (const pattern of userPatterns) {
      const match = this.matchUAPattern(uaLower, pattern);
      if (match) return { ...match, scope: 'user' };
    }

    return null;
  }

  /**
   * 匹配 UA 模式
   */
  private matchUAPattern(
    ua: string,
    raw: string
  ): { pattern: string; patternType: 'exact' | 'contains' | 'regex' } | null {
    try {
      // 尝试解析为 JSON 对象获取模式类型
      const parsed = JSON.parse(raw) as { pattern?: string; type?: string };
      const p = parsed.pattern || '';
      const type = (parsed.type || 'contains') as 'exact' | 'contains' | 'regex';

      switch (type) {
        case 'exact':
          return ua === p.toLowerCase() ? { pattern: p, patternType: 'exact' } : null;
        case 'contains':
          return ua.includes(p.toLowerCase()) ? { pattern: p, patternType: 'contains' } : null;
        case 'regex':
          try {
            return new RegExp(p, 'i').test(ua) ? { pattern: p, patternType: 'regex' } : null;
          } catch {
            return null;
          }
        default:
          return ua.includes(p.toLowerCase()) ? { pattern: p, patternType: 'contains' } : null;
      }
    } catch {
      // 如果不是 JSON，当作 contains 处理
      return ua.includes(raw.toLowerCase()) ? { pattern: raw, patternType: 'contains' } : null;
    }
  }

  /**
   * 检查 ISP/ASN 是否在黑名单中
   */
  private async checkISPBlacklist(
    asn: string,
    ispName: string | undefined,
    userId: number
  ): Promise<{ value: string; scope: 'global' | 'user' } | null> {
    const redis = getRedis();

    // 检查全局 ISP 黑名单（SET 存储 ASN）
    const globalKey = CacheKeys.blacklist.isps('global');
    if (await redis.sismember(globalKey, asn)) {
      return { value: asn, scope: 'global' };
    }

    // 检查用户 ISP 黑名单
    const userKey = CacheKeys.blacklist.isps(userId);
    if (await redis.sismember(userKey, asn)) {
      return { value: asn, scope: 'user' };
    }

    // 如果有 ISP 名称，也检查名称匹配（模糊匹配）
    if (ispName) {
      const ispLower = ispName.toLowerCase();

      // 获取 ISP 名称黑名单（存储为 HASH: asn -> isp_name）
      const globalIspNames = await redis.hgetall(`${globalKey}:names`);
      for (const name of Object.values(globalIspNames)) {
        if (ispLower.includes(name.toLowerCase())) {
          return { value: name, scope: 'global' };
        }
      }

      const userIspNames = await redis.hgetall(`${userKey}:names`);
      for (const name of Object.values(userIspNames)) {
        if (ispLower.includes(name.toLowerCase())) {
          return { value: name, scope: 'user' };
        }
      }
    }

    return null;
  }

  /**
   * 检查 Geo 是否在黑名单中
   */
  private async checkGeoBlacklist(
    country: string,
    region: string | undefined,
    userId: number
  ): Promise<{ value: string; scope: 'global' | 'user' } | null> {
    const redis = getRedis();

    // 检查全局 Geo 黑名单（HASH 存储: country_code -> block_type）
    const globalKey = CacheKeys.blacklist.geos('global');
    const globalBlockType = await redis.hget(globalKey, country);

    if (globalBlockType === 'block') {
      return { value: country, scope: 'global' };
    }

    // 检查用户 Geo 黑名单
    const userKey = CacheKeys.blacklist.geos(userId);
    const userBlockType = await redis.hget(userKey, country);

    if (userBlockType === 'block') {
      return { value: country, scope: 'user' };
    }

    // 检查区域级别黑名单（更精细的控制）
    if (region) {
      const regionKey = `${country}:${region}`;

      const globalRegionBlockType = await redis.hget(globalKey, regionKey);
      if (globalRegionBlockType === 'block') {
        return { value: regionKey, scope: 'global' };
      }

      const userRegionBlockType = await redis.hget(userKey, regionKey);
      if (userRegionBlockType === 'block') {
        return { value: regionKey, scope: 'user' };
      }
    }

    return null;
  }
}

export const l1Detector = new L1BlacklistDetector();
