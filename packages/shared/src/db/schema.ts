import { getDatabase } from './connection.js';

/**
 * 数据库 Schema 定义
 */
const SCHEMA = `
-- ==========================================
-- 用户表
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ==========================================
-- Offers 表
-- ==========================================
CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    -- 基本信息
    brand_name TEXT NOT NULL,
    brand_url TEXT NOT NULL,
    affiliate_link TEXT NOT NULL,

    -- 域名配置
    subdomain TEXT UNIQUE NOT NULL,
    custom_domain TEXT UNIQUE,
    custom_domain_status TEXT DEFAULT 'none' CHECK (custom_domain_status IN ('none', 'pending', 'verified', 'failed')),
    custom_domain_token TEXT,
    custom_domain_verified_at TIMESTAMP,

    -- Cloak 设置
    cloak_enabled INTEGER DEFAULT 0,
    cloak_enabled_at TIMESTAMP,
    cloak_disabled_at TIMESTAMP,

    -- 投放地区
    target_countries TEXT,
    target_countries_updated_at TIMESTAMP,

    -- 抓取状态
    scrape_status TEXT DEFAULT 'pending' CHECK (scrape_status IN ('pending', 'scraping', 'completed', 'failed')),
    scrape_error TEXT,
    scraped_at TIMESTAMP,
    scraped_data TEXT,
    page_title TEXT,
    page_description TEXT,

    -- 状态
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMP,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_offers_user ON offers(user_id);
CREATE INDEX IF NOT EXISTS idx_offers_subdomain ON offers(subdomain);
CREATE INDEX IF NOT EXISTS idx_offers_custom_domain ON offers(custom_domain);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);

-- ==========================================
-- Pages 表
-- ==========================================
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL,
    page_type TEXT NOT NULL CHECK (page_type IN ('money', 'safe')),

    -- 内容
    html_content TEXT,
    content_source TEXT DEFAULT 'scraped' CHECK (content_source IN ('scraped', 'generated', 'manual')),
    generation_prompt TEXT,
    generation_params TEXT,

    -- Safe Page 专用
    safe_page_type TEXT CHECK (safe_page_type IN ('review', 'tips', 'comparison', 'guide')),
    competitors TEXT,

    -- 状态
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'generated', 'published', 'failed')),
    generation_error TEXT,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP,

    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
    UNIQUE (offer_id, page_type)
);

CREATE INDEX IF NOT EXISTS idx_pages_offer ON pages(offer_id);
CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(page_type);

-- ==========================================
-- 黑名单 - IP（单个 IP 地址）
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    ip_address TEXT NOT NULL,
    reason TEXT,
    source TEXT DEFAULT 'manual',
    is_active INTEGER DEFAULT 1,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blacklist_ips_user ON blacklist_ips(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_ips_ip ON blacklist_ips(ip_address);
CREATE INDEX IF NOT EXISTS idx_blacklist_ips_active ON blacklist_ips(is_active);

-- ==========================================
-- 黑名单 - IP 范围（CIDR）
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_ip_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    cidr TEXT NOT NULL,
    reason TEXT,
    source TEXT DEFAULT 'manual',
    is_active INTEGER DEFAULT 1,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blacklist_ip_ranges_user ON blacklist_ip_ranges(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_ip_ranges_cidr ON blacklist_ip_ranges(cidr);
CREATE INDEX IF NOT EXISTS idx_blacklist_ip_ranges_active ON blacklist_ip_ranges(is_active);

-- ==========================================
-- 黑名单 - UA 模式
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_uas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    pattern TEXT NOT NULL,
    pattern_type TEXT DEFAULT 'contains' CHECK (pattern_type IN ('exact', 'contains', 'regex')),
    description TEXT,
    source TEXT DEFAULT 'manual',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blacklist_uas_user ON blacklist_uas(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_uas_active ON blacklist_uas(is_active);

-- ==========================================
-- 黑名单 - ISP/ASN
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_isps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    asn TEXT,
    isp_name TEXT,
    reason TEXT,
    source TEXT DEFAULT 'manual',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blacklist_isps_user ON blacklist_isps(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_isps_asn ON blacklist_isps(asn);
CREATE INDEX IF NOT EXISTS idx_blacklist_isps_active ON blacklist_isps(is_active);

-- ==========================================
-- 黑名单 - 地理位置
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_geos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    country_code TEXT NOT NULL,
    region_code TEXT,
    block_type TEXT DEFAULT 'block' CHECK (block_type IN ('block', 'high_risk')),
    reason TEXT,
    source TEXT DEFAULT 'manual',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blacklist_geos_user ON blacklist_geos(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_geos_country ON blacklist_geos(country_code);
CREATE INDEX IF NOT EXISTS idx_blacklist_geos_active ON blacklist_geos(is_active);

-- ==========================================
-- 黑名单数据源
-- ==========================================
CREATE TABLE IF NOT EXISTS blacklist_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK (source_type IN ('builtin', 'external', 'community')),
    url TEXT,
    description TEXT,
    update_frequency TEXT CHECK (update_frequency IN ('daily', 'weekly', 'monthly')),
    last_sync_at TIMESTAMP,
    next_sync_at TIMESTAMP,
    sync_status TEXT CHECK (sync_status IN ('success', 'failed', 'syncing')),
    sync_error TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- Cloak 日志表
-- ==========================================
CREATE TABLE IF NOT EXISTS cloak_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    offer_id INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    referer TEXT,
    request_url TEXT,

    -- 决策结果
    decision TEXT NOT NULL CHECK (decision IN ('money', 'safe')),
    decision_reason TEXT,
    fraud_score INTEGER DEFAULT 0,
    blocked_at_layer TEXT,
    detection_details TEXT,

    -- IP 信息
    ip_country TEXT,
    ip_city TEXT,
    ip_isp TEXT,
    ip_asn TEXT,
    is_datacenter INTEGER DEFAULT 0,
    is_vpn INTEGER DEFAULT 0,
    is_proxy INTEGER DEFAULT 0,

    -- 性能
    processing_time_ms INTEGER,

    -- 跟踪参数
    has_tracking_params INTEGER DEFAULT 0,
    gclid TEXT,

    -- 时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cloak_logs_user ON cloak_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_cloak_logs_offer ON cloak_logs(offer_id);
CREATE INDEX IF NOT EXISTS idx_cloak_logs_ip ON cloak_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_cloak_logs_decision ON cloak_logs(decision);
CREATE INDEX IF NOT EXISTS idx_cloak_logs_created ON cloak_logs(created_at);

-- ==========================================
-- 每日统计汇总表
-- ==========================================
CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    offer_id INTEGER,
    stat_date DATE NOT NULL,

    total_visits INTEGER DEFAULT 0,
    money_visits INTEGER DEFAULT 0,
    safe_visits INTEGER DEFAULT 0,

    unique_ips INTEGER DEFAULT 0,
    avg_fraud_score REAL DEFAULT 0,

    blocked_l1 INTEGER DEFAULT 0,
    blocked_l2 INTEGER DEFAULT 0,
    blocked_l3 INTEGER DEFAULT 0,
    blocked_l4 INTEGER DEFAULT 0,
    blocked_l5 INTEGER DEFAULT 0,
    blocked_timeout INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (user_id, offer_id, stat_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date ON daily_stats(user_id, stat_date);
`;

/**
 * 运行数据库迁移
 */
export function migrate(): void {
  const db = getDatabase();

  console.log('Running database migrations...');

  // 执行 schema
  db.exec(SCHEMA);

  console.log('Database migrations completed.');
}

/**
 * 检查表是否存在
 */
export function tableExists(tableName: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    )
    .get(tableName);
  return !!result;
}

// 如果直接运行此文件，则执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}
