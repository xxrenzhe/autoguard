import type { CloakConfig } from '../types';

/**
 * 默认 Cloak 配置
 *
 * 评分语义说明：
 * - 本实现使用 "高分 = 可信" 语义（100 = 完全可信，0 = 高度可疑）
 * - 设计文档使用 "高分 = 可疑" 语义（100 = 高度可疑，0 = 完全可信）
 * - 阈值判断：score < threshold → Safe，score >= threshold → Money
 *
 * 检测层映射：
 * - L1 (黑名单): IP/UA/ISP/Geo 精确匹配黑名单，命中直接 Safe
 * - L2 (IP 情报): 数据中心/VPN/代理检测，对应设计文档 IP(30%) + ISP(30%)
 * - L3 (地理位置): 目标地区检测，对应设计文档 Geo(15%)
 * - L4 (UA 检测): 机器人/无头浏览器检测，对应设计文档 UA(25%)
 * - L5 (Referer): 增强版功能，可疑来源检测
 */
export const defaultConfig: CloakConfig = {
  // 决策超时：200ms（设计文档要求 < 50ms，生产环境可调低）
  decisionTimeoutMs: 200,

  // 低于此分数触发 Safe（满分 100，高分=可信）
  // 设计文档阈值 40（高分=可疑），换算后约等于此处的 60
  safeModeThreshold: 60,

  // 各检测层权重
  // 设计文档: IP(30%) + UA(25%) + ISP(30%) + Geo(15%) = 100%
  // 本实现将 IP+ISP 合并到 L2，L5 为增强功能
  weights: {
    l1: 20, // 黑名单层（命中直接 Safe，得分时权重较低）
    l2: 30, // IP 情报（含 ISP/ASN 类型检测）
    l3: 15, // 地理位置
    l4: 25, // UA 检测
    l5: 10, // Referer/链接分析（增强功能）
  },

  // L2 - IP 情报配置
  l2: {
    blockDatacenter: true, // 阻止数据中心 IP
    blockVPN: true, // 阻止 VPN
    blockProxy: true, // 阻止代理
    blockTor: true, // 阻止 Tor
  },

  // L4 - UA 检测配置
  l4: {
    blockKnownBots: true, // 阻止已知机器人
    blockHeadless: true, // 阻止无头浏览器
    blockCrawlers: true, // 阻止爬虫
  },

  // L5 - Referer 检测配置
  l5: {
    requireReferer: false, // 不强制要求 Referer
    blockSuspiciousReferer: true, // 阻止可疑 Referer
  },
};

/**
 * 已知机器人 UA 模式
 */
export const KNOWN_BOT_PATTERNS = [
  // 搜索引擎
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'sogou',
  'exabot',
  'facebot',
  'ia_archiver',

  // 社交媒体爬虫
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'pinterest',
  'slackbot',
  'telegrambot',
  'whatsapp',
  'discordbot',

  // SEO/监控工具
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'dotbot',
  'rogerbot',
  'screaming frog',
  'gtmetrix',
  'pingdom',
  'uptimerobot',

  // 爬虫/采集器
  'scrapy',
  'curl/',
  'wget/',
  'python-requests',
  'python-urllib',
  'go-http-client',
  'java/',
  'apache-httpclient',
  'okhttp',
  'axios',
  'node-fetch',

  // 无头浏览器
  'headlesschrome',
  'phantomjs',
  'slimerjs',

  // 安全扫描
  'nmap',
  'sqlmap',
  'nikto',
  'masscan',
  'zap',
];

/**
 * 可疑 UA 特征
 */
export const SUSPICIOUS_UA_PATTERNS = [
  // 空或过短的 UA
  /^.{0,10}$/,

  // 只有产品名没有版本
  /^Mozilla\/\d+\.\d+$/,

  // 不一致的平台信息
  /Windows.*Mac OS|Mac OS.*Windows/i,

  // 自动化工具特征
  /headless/i,
  /phantom/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /webdriver/i,
  /chromedriver/i,
  /geckodriver/i,

  // 过时的浏览器版本
  /MSIE [1-9]\./,
  /Chrome\/[1-3]\d\./,
  /Firefox\/[1-4]\d\./,
];

/**
 * 可疑 Referer 域名
 */
export const SUSPICIOUS_REFERER_DOMAINS = [
  // 代理/匿名服务
  'hide.me',
  'hidemy.name',
  'anonymouse.org',

  // 链接检测服务
  'redirect-checker.org',
  'wheregoes.com',
  'redirectdetective.com',

  // SEO 工具
  'ahrefs.com',
  'semrush.com',
  'moz.com',

  // 安全检测
  'virustotal.com',
  'urlscan.io',
  'safebrowsing.google.com',
];

/**
 * 数据中心 ASN 列表（部分常见）
 */
export const DATACENTER_ASNS = [
  'AS14061', // DigitalOcean
  'AS16509', // Amazon AWS
  'AS15169', // Google Cloud
  'AS8075', // Microsoft Azure
  'AS13335', // Cloudflare
  'AS20473', // Vultr
  'AS63949', // Linode
  'AS16276', // OVH
  'AS24940', // Hetzner
  'AS36352', // ColoCrossing
  'AS46606', // Unified Layer
  'AS19871', // Network Solutions
  'AS27357', // Rackspace
  'AS21859', // Zenlayer
];

/**
 * 高风险国家/地区代码
 */
export const HIGH_RISK_COUNTRIES = [
  'RU', // 俄罗斯
  'CN', // 中国
  'IR', // 伊朗
  'KP', // 朝鲜
  'NG', // 尼日利亚
  'PK', // 巴基斯坦
  'BD', // 孟加拉国
  'VN', // 越南
  'UA', // 乌克兰
  'RO', // 罗马尼亚
];
