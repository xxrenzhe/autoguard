/**
 * L3 - 地理位置检测器
 * 检查访客是否来自目标投放地区
 */

import type {
  Detector,
  CloakRequest,
  DetectionContext,
  DetectorResult,
  L3Details,
} from '../types';
import { getIPIntelligence } from '../services/ip-intelligence';
import { HIGH_RISK_COUNTRIES } from '../config';

export class L3GeoDetector implements Detector {
  name = 'L3-Geo';
  layer = 'L3' as const;

  async detect(
    request: CloakRequest,
    context: DetectionContext
  ): Promise<DetectorResult> {
    // 获取 IP 地理信息
    const ipInfo = await getIPIntelligence(request.ip);

    const details: L3Details = {
      passed: true,
      country: ipInfo.country,
      region: ipInfo.region,
      city: ipInfo.city,
      isTargetRegion: false,
      isHighRiskRegion: false,
      geoInfo: ipInfo.country
        ? {
            country: ipInfo.country,
            countryName: ipInfo.countryName || ipInfo.country,
            region: ipInfo.region,
            city: ipInfo.city,
            timezone: ipInfo.timezone,
            latitude: ipInfo.latitude,
            longitude: ipInfo.longitude,
          }
        : undefined,
    };

    let score = 100;
    const reasons: string[] = [];

    // 无法获取地理信息
    if (!ipInfo.country) {
      // If target countries are configured, unknown location = fail (redirect to Safe)
      // This is a security measure: don't show Money page to unknown origins
      if (context.targetCountries && context.targetCountries.length > 0) {
        score = 0;
        details.passed = false;
        reasons.push('Cannot determine location (target regions configured)');
        return {
          passed: false,
          score,
          reason: reasons.join(', '),
          details,
        };
      }

      // No target countries configured, allow with reduced score
      score -= 20;
      reasons.push('Cannot determine location');
      return {
        passed: true,
        score,
        reason: reasons.join(', '),
        details,
      };
    }

    // 检查是否为目标地区
    if (context.targetCountries && context.targetCountries.length > 0) {
      const isTarget = context.targetCountries.includes(ipInfo.country);
      details.isTargetRegion = isTarget;

      if (!isTarget) {
        // 非目标地区，直接转到 Safe
        score = 0;
        details.passed = false;
        reasons.push(`Not in target regions (${ipInfo.country})`);
        return {
          passed: false,
          score,
          reason: reasons.join(', '),
          details,
        };
      }
    }

    // 检查高风险地区
    if (HIGH_RISK_COUNTRIES.includes(ipInfo.country)) {
      details.isHighRiskRegion = true;
      score -= 30;
      reasons.push(`High risk region (${ipInfo.country})`);
    }

    score = Math.max(0, score);
    details.passed = score >= 50;

    return {
      passed: details.passed,
      score,
      reason: reasons.length > 0 ? reasons.join(', ') : undefined,
      details,
    };
  }
}

export const l3Detector = new L3GeoDetector();
