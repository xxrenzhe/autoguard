/**
 * Cloak 检测请求上下文
 */
export interface CloakRequest {
  ip: string;
  userAgent: string;
  referer?: string;
  url: string;
  host: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Cloak 检测决策结果
 */
export interface CloakDecision {
  decision: 'money' | 'safe';
  score: number;
  blockedAt?: DetectionLayer | 'TIMEOUT';
  reason?: string;
  details: DetectionDetails;
  processingTime: number;
}

/**
 * 检测层级
 */
export type DetectionLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/**
 * 检测详情
 */
export interface DetectionDetails {
  l1?: L1Details;
  l2?: L2Details;
  l3?: L3Details;
  l4?: L4Details;
  l5?: L5Details;
}

/**
 * L1 - 静态黑名单检测详情
 */
export interface L1Details {
  passed: boolean;
  ipBlocked: boolean;
  uaBlocked: boolean;
  ispBlocked: boolean;
  geoBlocked: boolean;
  blockedReason?: string;
  blockedType?: 'ip' | 'ip_range' | 'ua' | 'isp' | 'geo';
  blockedValue?: string;
  blockedScope?: 'global' | 'user';
  blockedPatternType?: 'exact' | 'contains' | 'regex';
}

/**
 * L2 - IP 情报检测详情
 */
export interface L2Details {
  passed: boolean;
  isDatacenter: boolean;
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isResidential: boolean;
  threatLevel: 'low' | 'medium' | 'high';
  ispInfo?: {
    asn: string;
    org: string;
    type: 'residential' | 'business' | 'datacenter' | 'mobile' | 'unknown';
  };
}

/**
 * L3 - 地理位置检测详情
 */
export interface L3Details {
  passed: boolean;
  country?: string;
  region?: string;
  city?: string;
  isTargetRegion: boolean;
  isHighRiskRegion: boolean;
  geoInfo?: {
    country: string;
    countryName: string;
    region?: string;
    city?: string;
    timezone?: string;
    latitude?: number;
    longitude?: number;
  };
}

/**
 * L4 - User-Agent 检测详情
 */
export interface L4Details {
  passed: boolean;
  isBot: boolean;
  isCrawler: boolean;
  isHeadless: boolean;
  isMobile: boolean;
  browser?: string;
  browserVersion?: string;
  os?: string;
  device?: string;
  suspiciousPatterns: string[];
}

/**
 * L5 - Referer/链接分析详情
 */
export interface L5Details {
  passed: boolean;
  hasReferer: boolean;
  refererDomain?: string;
  isDirectVisit: boolean;
  hasTrackingParams: boolean;
  trackingParams: TrackingParams;
  suspiciousReferer: boolean;
}

/**
 * 跟踪参数
 */
export interface TrackingParams {
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
  twclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  affiliate_id?: string;
  click_id?: string;
  [key: string]: string | undefined;
}

/**
 * 检测器接口
 */
export interface Detector {
  name: string;
  layer: DetectionLayer;
  detect(request: CloakRequest, context: DetectionContext): Promise<DetectorResult>;
}

/**
 * 检测器返回结果
 */
export interface DetectorResult {
  passed: boolean;
  score: number;
  reason?: string;
  details: L1Details | L2Details | L3Details | L4Details | L5Details | Record<string, unknown>;
}

/**
 * 检测上下文（传递给各检测器）
 */
export interface DetectionContext {
  offerId: number;
  userId: number;
  targetCountries?: string[];
  cloakEnabled: boolean;
}

/**
 * Cloak 配置
 */
export interface CloakConfig {
  // 超时配置
  decisionTimeoutMs: number;

  // 阈值配置
  safeModeThreshold: number; // 低于此分数触发 Safe

  // 检测器权重
  weights: {
    l1: number;
    l2: number;
    l3: number;
    l4: number;
    l5: number;
  };

  // 各层配置
  l2: {
    blockDatacenter: boolean;
    blockVPN: boolean;
    blockProxy: boolean;
    blockTor: boolean;
  };

  l4: {
    blockKnownBots: boolean;
    blockHeadless: boolean;
    blockCrawlers: boolean;
  };

  l5: {
    requireReferer: boolean;
    blockSuspiciousReferer: boolean;
  };
}

/**
 * IP 情报提供者接口
 */
export interface IPIntelligenceProvider {
  lookup(ip: string): Promise<IPLookupResult>;
}

/**
 * IP 查询结果
 */
export interface IPLookupResult {
  country?: string;
  countryName?: string;
  region?: string;
  city?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  asn?: string;
  org?: string;
  isp?: string;
  isDatacenter: boolean;
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isResidential: boolean;
  isHosting: boolean;
  connectionType?: 'residential' | 'business' | 'datacenter' | 'mobile' | 'unknown';
}
