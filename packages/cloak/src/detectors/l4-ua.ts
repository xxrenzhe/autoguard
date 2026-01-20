/**
 * L4 - User-Agent 检测器
 * 检测机器人、爬虫、无头浏览器等
 */

import type {
  Detector,
  CloakRequest,
  DetectionContext,
  DetectorResult,
  L4Details,
} from '../types';
import {
  KNOWN_BOT_PATTERNS,
  SUSPICIOUS_UA_PATTERNS,
  defaultConfig,
} from '../config';

export class L4UADetector implements Detector {
  name = 'L4-UserAgent';
  layer = 'L4' as const;

  async detect(
    request: CloakRequest,
    _context: DetectionContext
  ): Promise<DetectorResult> {
    const ua = request.userAgent || '';
    const uaLower = ua.toLowerCase();

    const details: L4Details = {
      passed: true,
      isBot: false,
      isCrawler: false,
      isHeadless: false,
      isMobile: false,
      suspiciousPatterns: [],
    };

    let score = 100;
    const reasons: string[] = [];
    const config = defaultConfig.l4;

    // 空 UA 直接高风险
    if (!ua || ua.length < 10) {
      score = 0;
      details.passed = false;
      reasons.push('Empty or very short UA');
      return {
        passed: false,
        score,
        reason: reasons.join(', '),
        details,
      };
    }

    // 检查已知机器人模式
    for (const pattern of KNOWN_BOT_PATTERNS) {
      if (uaLower.includes(pattern)) {
        details.isBot = true;
        if (config.blockKnownBots) {
          score = 0;
          details.passed = false;
          reasons.push(`Known bot: ${pattern}`);
          return {
            passed: false,
            score,
            reason: reasons.join(', '),
            details,
          };
        }
      }
    }

    // 检查爬虫特征
    if (
      uaLower.includes('crawler') ||
      uaLower.includes('spider') ||
      uaLower.includes('scraper')
    ) {
      details.isCrawler = true;
      if (config.blockCrawlers) {
        score -= 50;
        reasons.push('Crawler detected');
      }
    }

    // 检查无头浏览器特征
    if (
      uaLower.includes('headless') ||
      uaLower.includes('phantomjs') ||
      uaLower.includes('puppeteer') ||
      uaLower.includes('playwright') ||
      uaLower.includes('selenium') ||
      uaLower.includes('webdriver')
    ) {
      details.isHeadless = true;
      if (config.blockHeadless) {
        score -= 50;
        reasons.push('Headless browser detected');
      }
    }

    // 检查可疑 UA 模式
    for (const pattern of SUSPICIOUS_UA_PATTERNS) {
      if (pattern.test(ua)) {
        details.suspiciousPatterns.push(pattern.source);
        score -= 15;
      }
    }

    // 解析浏览器信息
    const browserInfo = this.parseBrowser(ua);
    details.browser = browserInfo.browser;
    details.browserVersion = browserInfo.version;
    details.os = browserInfo.os;
    details.isMobile = browserInfo.isMobile;

    // 检查过时的浏览器版本
    if (browserInfo.isOutdated) {
      score -= 20;
      reasons.push('Outdated browser version');
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
   * 解析浏览器信息
   */
  private parseBrowser(ua: string): {
    browser?: string;
    version?: string;
    os?: string;
    isMobile: boolean;
    isOutdated: boolean;
  } {
    const result = {
      browser: undefined as string | undefined,
      version: undefined as string | undefined,
      os: undefined as string | undefined,
      isMobile: false,
      isOutdated: false,
    };

    // 检测移动设备
    result.isMobile =
      /Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        ua
      );

    // 检测操作系统
    if (/Windows NT 10/i.test(ua)) {
      result.os = 'Windows 10/11';
    } else if (/Windows NT 6\.3/i.test(ua)) {
      result.os = 'Windows 8.1';
    } else if (/Windows NT 6\.2/i.test(ua)) {
      result.os = 'Windows 8';
    } else if (/Windows NT 6\.1/i.test(ua)) {
      result.os = 'Windows 7';
      result.isOutdated = true;
    } else if (/Mac OS X/i.test(ua)) {
      result.os = 'macOS';
    } else if (/Linux/i.test(ua)) {
      result.os = 'Linux';
    } else if (/Android/i.test(ua)) {
      result.os = 'Android';
    } else if (/iOS|iPhone|iPad/i.test(ua)) {
      result.os = 'iOS';
    }

    // 检测浏览器
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    const firefoxMatch = ua.match(/Firefox\/(\d+)/);
    const safariMatch = ua.match(/Version\/(\d+).*Safari/);
    const edgeMatch = ua.match(/Edg\/(\d+)/);

    if (edgeMatch) {
      result.browser = 'Edge';
      result.version = edgeMatch[1];
    } else if (chromeMatch && !ua.includes('Edg')) {
      result.browser = 'Chrome';
      result.version = chromeMatch[1];
      // Chrome 90 以下视为过时
      if (parseInt(chromeMatch[1]!, 10) < 90) {
        result.isOutdated = true;
      }
    } else if (firefoxMatch) {
      result.browser = 'Firefox';
      result.version = firefoxMatch[1];
      // Firefox 90 以下视为过时
      if (parseInt(firefoxMatch[1]!, 10) < 90) {
        result.isOutdated = true;
      }
    } else if (safariMatch) {
      result.browser = 'Safari';
      result.version = safariMatch[1];
    }

    return result;
  }
}

export const l4Detector = new L4UADetector();
