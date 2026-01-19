/**
 * L5 - Referer/链接分析检测器
 * 检测 Referer 来源和跟踪参数
 */

import type {
  Detector,
  CloakRequest,
  DetectionContext,
  DetectorResult,
  L5Details,
  TrackingParams,
} from '../types.js';
import { SUSPICIOUS_REFERER_DOMAINS, defaultConfig } from '../config/index.js';

export class L5RefererDetector implements Detector {
  name = 'L5-Referer';
  layer = 'L5' as const;

  async detect(
    request: CloakRequest,
    _context: DetectionContext
  ): Promise<DetectorResult> {
    const referer = request.referer || '';
    const url = request.url || '';

    // 解析跟踪参数
    const trackingParams = this.extractTrackingParams(url);
    const hasTrackingParams = Object.keys(trackingParams).length > 0;

    const details: L5Details = {
      passed: true,
      hasReferer: !!referer,
      refererDomain: referer ? this.extractDomain(referer) : undefined,
      isDirectVisit: !referer,
      hasTrackingParams,
      trackingParams,
      suspiciousReferer: false,
    };

    let score = 100;
    const reasons: string[] = [];
    const config = defaultConfig.l5;

    // 检查 Referer
    if (!referer) {
      // 直接访问
      if (config.requireReferer) {
        score -= 20;
        reasons.push('No referer (direct visit)');
      }
    } else {
      // 检查可疑 Referer
      const refererDomain = details.refererDomain?.toLowerCase() || '';
      for (const domain of SUSPICIOUS_REFERER_DOMAINS) {
        if (refererDomain.includes(domain)) {
          details.suspiciousReferer = true;
          if (config.blockSuspiciousReferer) {
            score -= 40;
            reasons.push(`Suspicious referer: ${domain}`);
          }
          break;
        }
      }
    }

    // 有跟踪参数加分（说明是真实广告流量）
    if (trackingParams.gclid) {
      score = Math.min(100, score + 15);
    } else if (trackingParams.fbclid || trackingParams.msclkid) {
      score = Math.min(100, score + 10);
    } else if (trackingParams.utm_source) {
      score = Math.min(100, score + 5);
    }

    score = Math.max(0, Math.min(100, score));
    details.passed = score >= 50;

    return {
      passed: details.passed,
      score,
      reason: reasons.length > 0 ? reasons.join(', ') : undefined,
      details,
    };
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return undefined;
    }
  }

  /**
   * 提取跟踪参数
   */
  private extractTrackingParams(url: string): TrackingParams {
    const params: TrackingParams = {};

    try {
      const parsed = new URL(url, 'http://localhost');
      const searchParams = parsed.searchParams;

      // Google Ads
      const gclid = searchParams.get('gclid');
      if (gclid) params.gclid = gclid;

      // Facebook Ads
      const fbclid = searchParams.get('fbclid');
      if (fbclid) params.fbclid = fbclid;

      // Microsoft Ads
      const msclkid = searchParams.get('msclkid');
      if (msclkid) params.msclkid = msclkid;

      // TikTok Ads
      const ttclid = searchParams.get('ttclid');
      if (ttclid) params.ttclid = ttclid;

      // Twitter Ads
      const twclid = searchParams.get('twclid');
      if (twclid) params.twclid = twclid;

      // UTM 参数
      const utmSource = searchParams.get('utm_source');
      if (utmSource) params.utm_source = utmSource;

      const utmMedium = searchParams.get('utm_medium');
      if (utmMedium) params.utm_medium = utmMedium;

      const utmCampaign = searchParams.get('utm_campaign');
      if (utmCampaign) params.utm_campaign = utmCampaign;

      const utmTerm = searchParams.get('utm_term');
      if (utmTerm) params.utm_term = utmTerm;

      const utmContent = searchParams.get('utm_content');
      if (utmContent) params.utm_content = utmContent;

      // 其他常见参数
      const ref = searchParams.get('ref');
      if (ref) params.ref = ref;

      const affiliateId = searchParams.get('affiliate_id');
      if (affiliateId) params.affiliate_id = affiliateId;

      const clickId = searchParams.get('click_id');
      if (clickId) params.click_id = clickId;
    } catch {
      // URL 解析失败，返回空对象
    }

    return params;
  }
}

export const l5Detector = new L5RefererDetector();
