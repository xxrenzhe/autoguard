/**
 * L2 - IP 情报检测器
 * 使用 MaxMind 数据库检测 IP 情报
 */

import type {
  Detector,
  CloakRequest,
  DetectionContext,
  DetectorResult,
  L2Details,
  IPLookupResult,
} from '../types';
import { getIPIntelligence } from '../services/ip-intelligence';
import { defaultConfig, DATACENTER_ASNS } from '../config';

export class L2IPIntelligenceDetector implements Detector {
  name = 'L2-IPIntelligence';
  layer = 'L2' as const;

  async detect(
    request: CloakRequest,
    context: DetectionContext
  ): Promise<DetectorResult> {
    // 获取 IP 情报
    const ipInfo = await getIPIntelligence(request.ip);

    const details: L2Details = {
      passed: true,
      isDatacenter: ipInfo.isDatacenter,
      isVPN: ipInfo.isVPN,
      isProxy: ipInfo.isProxy,
      isTor: ipInfo.isTor,
      isResidential: ipInfo.isResidential,
      threatLevel: 'low',
      ispInfo: ipInfo.asn
        ? {
            asn: ipInfo.asn,
            org: ipInfo.org || '',
            type: ipInfo.connectionType || 'unknown',
          }
        : undefined,
    };

    let score = 100;
    const reasons: string[] = [];
    const config = defaultConfig.l2;

    // 检查数据中心 IP
    if (ipInfo.isDatacenter || ipInfo.isHosting) {
      if (config.blockDatacenter) {
        score -= 40;
        reasons.push('Datacenter IP');
        details.threatLevel = 'high';
      }
    }

    // 检查 VPN
    if (ipInfo.isVPN) {
      if (config.blockVPN) {
        score -= 30;
        reasons.push('VPN detected');
        details.threatLevel = details.threatLevel === 'high' ? 'high' : 'medium';
      }
    }

    // 检查代理
    if (ipInfo.isProxy) {
      if (config.blockProxy) {
        score -= 30;
        reasons.push('Proxy detected');
        details.threatLevel = details.threatLevel === 'high' ? 'high' : 'medium';
      }
    }

    // 检查 Tor
    if (ipInfo.isTor) {
      if (config.blockTor) {
        score -= 50;
        reasons.push('Tor exit node');
        details.threatLevel = 'high';
      }
    }

    // 检查已知数据中心 ASN
    if (ipInfo.asn && DATACENTER_ASNS.includes(ipInfo.asn)) {
      score -= 20;
      reasons.push('Known datacenter ASN');
    }

    // 住宅 IP 加分
    if (ipInfo.isResidential) {
      score = Math.min(100, score + 10);
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

export const l2Detector = new L2IPIntelligenceDetector();
