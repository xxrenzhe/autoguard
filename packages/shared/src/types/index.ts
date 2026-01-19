/**
 * 用户相关类型
 */
export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'suspended';

export interface UserWithoutPassword extends Omit<User, 'password_hash'> {}

/**
 * Offer 相关类型
 */
export interface Offer {
  id: number;
  user_id: number;

  // 基本信息
  brand_name: string;
  brand_url: string;
  affiliate_link: string;

  // 域名配置
  subdomain: string;
  custom_domain: string | null;
  custom_domain_status: CustomDomainStatus;
  custom_domain_token: string | null;
  custom_domain_verified_at: string | null;

  // Cloak 设置
  cloak_enabled: number; // SQLite boolean: 0 | 1
  cloak_enabled_at: string | null;
  cloak_disabled_at: string | null;

  // 投放地区
  target_countries: string | null; // JSON array: ["US", "CA"]
  target_countries_updated_at: string | null;

  // 抓取状态
  scrape_status: ScrapeStatus;
  scrape_error: string | null;
  scraped_at: string | null;
  scraped_data: string | null; // JSON
  page_title: string | null;
  page_description: string | null;

  // 状态
  status: OfferStatus;
  is_deleted: number;
  deleted_at: string | null;

  // 时间戳
  created_at: string;
  updated_at: string;
}

export type CustomDomainStatus = 'none' | 'pending' | 'verified' | 'failed';
export type ScrapeStatus = 'pending' | 'scraping' | 'completed' | 'failed';
export type OfferStatus = 'draft' | 'active' | 'paused';

/**
 * 页面相关类型
 */
export interface Page {
  id: number;
  offer_id: number;
  page_type: PageType;

  // 内容
  html_content: string | null;
  content_source: ContentSource;
  generation_prompt: string | null;
  generation_params: string | null; // JSON

  // Safe Page 专用
  safe_page_type: SafePageType | null;
  competitors: string | null; // JSON array

  // 状态
  status: PageStatus;
  generation_error: string | null;

  // 时间戳
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export type PageType = 'money' | 'safe';
export type ContentSource = 'scraped' | 'generated' | 'manual';
export type SafePageType = 'review' | 'tips' | 'comparison' | 'guide';
export type PageStatus = 'draft' | 'generating' | 'generated' | 'published' | 'failed';

/**
 * 黑名单相关类型
 */
export interface BlacklistIP {
  id: number;
  user_id: number | null; // null = global
  ip_address: string;
  reason: string | null;
  source: string | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlacklistIPRange {
  id: number;
  user_id: number | null; // null = global
  cidr: string;
  reason: string | null;
  source: string | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlacklistUA {
  id: number;
  user_id: number | null;
  pattern: string;
  pattern_type: 'exact' | 'contains' | 'regex';
  description: string | null;
  source: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface BlacklistISP {
  id: number;
  user_id: number | null;
  asn: string | null;
  isp_name: string | null;
  reason: string | null;
  source: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface BlacklistGeo {
  id: number;
  user_id: number | null;
  country_code: string;
  region_code: string | null;
  block_type: 'block' | 'high_risk';
  reason: string | null;
  source: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface BlacklistSource {
  id: number;
  name: string;
  source_type: 'builtin' | 'external' | 'community';
  url: string | null;
  description: string | null;
  update_frequency: 'daily' | 'weekly' | 'monthly';
  last_sync_at: string | null;
  next_sync_at: string | null;
  sync_status: 'success' | 'failed' | 'syncing' | null;
  sync_error: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/**
 * Cloak 日志类型
 */
export interface CloakLog {
  id: number;
  user_id: number;
  offer_id: number;
  ip_address: string;
  user_agent: string;
  referer: string | null;
  request_url: string;

  // 决策结果
  decision: 'money' | 'safe';
  decision_reason: string | null;
  fraud_score: number;
  blocked_at_layer: string | null;
  detection_details: string | null; // JSON

  // IP 信息
  ip_country: string | null;
  ip_city: string | null;
  ip_isp: string | null;
  ip_asn: string | null;
  is_datacenter: number;
  is_vpn: number;
  is_proxy: number;

  // 性能
  processing_time_ms: number;

  // 跟踪参数
  has_tracking_params: number;
  gclid: string | null;

  // 时间
  created_at: string;
}

/**
 * Cloak 决策相关类型
 */
export interface CloakDecision {
  decision: 'money' | 'safe';
  score: number;
  blockedAt?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'TIMEOUT';
  reason?: string;
  details: Record<string, unknown>;
  processingTime: number;
  trackingParams: TrackingParams;
}

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
 * IP 情报类型
 */
export interface IPIntelligence {
  country?: string;
  city?: string;
  asn?: string;
  org?: string;
  isDatacenter: boolean;
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isResidential: boolean;
}

/**
 * API 响应类型
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

/**
 * 分页参数
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
