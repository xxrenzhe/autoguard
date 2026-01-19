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
} from '../types.js';
import { ipInCIDR } from '@autoguard/shared';
import { getIPIntelligence } from '../services/ip-intelligence.js';

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
    const ipBlocked = await this.checkIPBlacklist(request.ip, context.userId);
    if (ipBlocked) {
      details.passed = false;
      details.ipBlocked = true;
      details.blockedReason = 'IP in blacklist';
      return {
        passed: false,
        score: 0,
        reason: 'IP blocked by L1 blacklist',
        details,
      };
    }

    // 2. 检查 UA 黑名单
    const uaBlocked = await this.checkUABlacklist(request.userAgent, context.userId);
    if (uaBlocked) {
      details.passed = false;
      details.uaBlocked = true;
      details.blockedReason = 'User-Agent in blacklist';
      return {
        passed: false,
        score: 0,
        reason: 'UA blocked by L1 blacklist',
        details,
      };
    }

    // 3. 获取 IP 信息用于 ISP 和 Geo 检查
    const ipInfo = await getIPIntelligence(request.ip);

    // 4. 检查 ISP/ASN 黑名单
    if (ipInfo.asn) {
      const ispBlocked = await this.checkISPBlacklist(ipInfo.asn, ipInfo.org, context.userId);
      if (ispBlocked) {
        details.passed = false;
        details.ispBlocked = true;
        details.blockedReason = `ISP/ASN blocked: ${ipInfo.asn}`;
        return {
          passed: false,
          score: 0,
          reason: 'ISP/ASN blocked by L1 blacklist',
          details,
        };
      }
    }

    // 5. 检查 Geo 黑名单
    if (ipInfo.country) {
      const geoBlocked = await this.checkGeoBlacklist(
        ipInfo.country,
        ipInfo.region,
        context.userId
      );
      if (geoBlocked) {
        details.passed = false;
        details.geoBlocked = true;
        details.blockedReason = `Geo blocked: ${ipInfo.country}${ipInfo.region ? `/${ipInfo.region}` : ''}`;
        return {
          passed: false,
          score: 0,
          reason: 'Geo blocked by L1 blacklist',
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
  private async checkIPBlacklist(ip: string, userId: number): Promise<boolean> {
    const redis = getRedis();

    // 检查全局 IP 黑名单（精确匹配）
    const globalKey = CacheKeys.blacklist.ip('global');
    if (await redis.sismember(globalKey, ip)) {
      return true;
    }

    // 检查用户 IP 黑名单（精确匹配）
    const userKey = CacheKeys.blacklist.ip(userId);
    if (await redis.sismember(userKey, ip)) {
      return true;
    }

    // 检查 CIDR 范围
    const globalRanges = await this.getCIDRRanges('global');
    for (const cidr of globalRanges) {
      if (ipInCIDR(ip, cidr)) {
        return true;
      }
    }

    const userRanges = await this.getCIDRRanges(userId);
    for (const cidr of userRanges) {
      if (ipInCIDR(ip, cidr)) {
        return true;
      }
    }

    return false;
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
  private async checkUABlacklist(ua: string, userId: number): Promise<boolean> {
    const redis = getRedis();
    const uaLower = ua.toLowerCase();

    // 获取全局 UA 模式
    const globalKey = CacheKeys.blacklist.uas('global');
    const globalPatterns = await redis.lrange(globalKey, 0, -1);

    for (const pattern of globalPatterns) {
      if (this.matchUAPattern(uaLower, pattern)) {
        return true;
      }
    }

    // 获取用户 UA 模式
    const userKey = CacheKeys.blacklist.uas(userId);
    const userPatterns = await redis.lrange(userKey, 0, -1);

    for (const pattern of userPatterns) {
      if (this.matchUAPattern(uaLower, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 匹配 UA 模式
   */
  private matchUAPattern(ua: string, pattern: string): boolean {
    try {
      // 尝试解析为 JSON 对象获取模式类型
      const parsed = JSON.parse(pattern) as { pattern: string; type: string };
      const { pattern: p, type } = parsed;

      switch (type) {
        case 'exact':
          return ua === p.toLowerCase();
        case 'contains':
          return ua.includes(p.toLowerCase());
        case 'regex':
          return new RegExp(p, 'i').test(ua);
        default:
          return ua.includes(p.toLowerCase());
      }
    } catch {
      // 如果不是 JSON，当作 contains 处理
      return ua.includes(pattern.toLowerCase());
    }
  }

  /**
   * 检查 ISP/ASN 是否在黑名单中
   */
  private async checkISPBlacklist(
    asn: string,
    ispName: string | undefined,
    userId: number
  ): Promise<boolean> {
    const redis = getRedis();

    // 检查全局 ISP 黑名单（SET 存储 ASN）
    const globalKey = CacheKeys.blacklist.isps('global');
    if (await redis.sismember(globalKey, asn)) {
      return true;
    }

    // 检查用户 ISP 黑名单
    const userKey = CacheKeys.blacklist.isps(userId);
    if (await redis.sismember(userKey, asn)) {
      return true;
    }

    // 如果有 ISP 名称，也检查名称匹配（模糊匹配）
    if (ispName) {
      const ispLower = ispName.toLowerCase();

      // 获取 ISP 名称黑名单（存储为 HASH: asn -> isp_name）
      const globalIspNames = await redis.hgetall(`${globalKey}:names`);
      for (const name of Object.values(globalIspNames)) {
        if (ispLower.includes(name.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 检查 Geo 是否在黑名单中
   */
  private async checkGeoBlacklist(
    country: string,
    region: string | undefined,
    userId: number
  ): Promise<boolean> {
    const redis = getRedis();

    // 检查全局 Geo 黑名单（HASH 存储: country_code -> block_type）
    const globalKey = CacheKeys.blacklist.geos('global');
    const globalBlockType = await redis.hget(globalKey, country);

    if (globalBlockType === 'block') {
      return true;
    }

    // 检查用户 Geo 黑名单
    const userKey = CacheKeys.blacklist.geos(userId);
    const userBlockType = await redis.hget(userKey, country);

    if (userBlockType === 'block') {
      return true;
    }

    // 检查区域级别黑名单（更精细的控制）
    if (region) {
      const regionKey = `${country}:${region}`;

      const globalRegionBlockType = await redis.hget(globalKey, regionKey);
      if (globalRegionBlockType === 'block') {
        return true;
      }

      const userRegionBlockType = await redis.hget(userKey, regionKey);
      if (userRegionBlockType === 'block') {
        return true;
      }
    }

    return false;
  }
}

export const l1Detector = new L1BlacklistDetector();
