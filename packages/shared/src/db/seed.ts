import { getDatabase, queryOne, execute } from './connection';
import { hashPassword } from '../auth/password';

/**
 * 检查是否已有种子数据
 */
async function hasSeeded(): Promise<boolean> {
  const user = queryOne<{ id: number }>('SELECT id FROM users LIMIT 1');
  return !!user;
}

/**
 * 种子数据 - 默认管理员用户
 */
async function seedAdminUser(): Promise<void> {
  const existingAdmin = queryOne<{ id: number }>(
    'SELECT id FROM users WHERE email = ?',
    ['admin@autoguard.local']
  );

  if (existingAdmin) {
    console.log('Admin user already exists, skipping...');
    return;
  }

  const passwordHash = await hashPassword('Admin@123456');

  execute(
    `INSERT INTO users (email, password_hash, display_name, role, status)
     VALUES (?, ?, ?, ?, ?)`,
    ['admin@autoguard.local', passwordHash, 'Administrator', 'admin', 'active']
  );

  console.log('Default admin user created: admin@autoguard.local / Admin@123456');
}

/**
 * 种子数据 - 黑名单数据源
 */
function seedBlacklistSources(): void {
  const sources = [
    {
      name: 'google-bots',
      source_type: 'builtin',
      description: 'Google 官方爬虫 IP 库',
      update_frequency: 'daily',
    },
    {
      name: 'facebook-bots',
      source_type: 'builtin',
      description: 'Facebook 官方爬虫 IP 库',
      update_frequency: 'daily',
    },
    {
      name: 'datacenter-ips',
      source_type: 'builtin',
      description: '数据中心 IP 库',
      update_frequency: 'weekly',
    },
    {
      name: 'known-proxies',
      source_type: 'builtin',
      description: '已知代理/VPN IP 库',
      update_frequency: 'daily',
    },
  ];

  for (const source of sources) {
    const existing = queryOne<{ id: number }>(
      'SELECT id FROM blacklist_sources WHERE name = ?',
      [source.name]
    );

    if (!existing) {
      execute(
        `INSERT INTO blacklist_sources (name, source_type, description, update_frequency, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [source.name, source.source_type, source.description, source.update_frequency]
      );
      console.log(`Created blacklist source: ${source.name}`);
    }
  }
}

/**
 * 种子数据 - 默认 UA 黑名单
 */
function seedDefaultUABlacklist(): void {
  const patterns = [
    { pattern: 'Googlebot', pattern_type: 'contains', description: 'Google 爬虫' },
    { pattern: 'bingbot', pattern_type: 'contains', description: 'Bing 爬虫' },
    { pattern: 'facebookexternalhit', pattern_type: 'contains', description: 'Facebook 爬虫' },
    { pattern: 'AdsBot-Google', pattern_type: 'contains', description: 'Google Ads 审核机器人' },
    { pattern: 'HeadlessChrome', pattern_type: 'contains', description: '无头浏览器' },
    { pattern: 'PhantomJS', pattern_type: 'contains', description: 'PhantomJS' },
    { pattern: 'Puppeteer', pattern_type: 'contains', description: 'Puppeteer' },
    { pattern: 'Playwright', pattern_type: 'contains', description: 'Playwright' },
    { pattern: 'Slurp', pattern_type: 'contains', description: 'Yahoo 爬虫' },
    { pattern: 'DuckDuckBot', pattern_type: 'contains', description: 'DuckDuckGo 爬虫' },
    { pattern: 'Baiduspider', pattern_type: 'contains', description: '百度爬虫' },
    { pattern: 'YandexBot', pattern_type: 'contains', description: 'Yandex 爬虫' },
    { pattern: 'Sogou', pattern_type: 'contains', description: '搜狗爬虫' },
    { pattern: 'Exabot', pattern_type: 'contains', description: 'Exabot 爬虫' },
    { pattern: 'ia_archiver', pattern_type: 'contains', description: 'Internet Archive' },
    { pattern: 'Applebot', pattern_type: 'contains', description: 'Apple 爬虫' },
    { pattern: 'LinkedInBot', pattern_type: 'contains', description: 'LinkedIn 爬虫' },
    { pattern: 'Twitterbot', pattern_type: 'contains', description: 'Twitter 爬虫' },
    { pattern: 'Slackbot', pattern_type: 'contains', description: 'Slack 爬虫' },
    { pattern: 'Discordbot', pattern_type: 'contains', description: 'Discord 爬虫' },
    { pattern: 'WhatsApp', pattern_type: 'contains', description: 'WhatsApp 爬虫' },
    { pattern: 'Telegrambot', pattern_type: 'contains', description: 'Telegram 爬虫' },
    { pattern: 'SemrushBot', pattern_type: 'contains', description: 'SEMrush 爬虫' },
    { pattern: 'AhrefsBot', pattern_type: 'contains', description: 'Ahrefs 爬虫' },
    { pattern: 'MJ12bot', pattern_type: 'contains', description: 'Majestic 爬虫' },
    { pattern: 'DotBot', pattern_type: 'contains', description: 'DotBot 爬虫' },
    { pattern: 'PetalBot', pattern_type: 'contains', description: 'Huawei PetalBot' },
    { pattern: 'curl/', pattern_type: 'contains', description: 'cURL' },
    { pattern: 'wget/', pattern_type: 'contains', description: 'Wget' },
    { pattern: 'python-requests', pattern_type: 'contains', description: 'Python Requests' },
    { pattern: 'axios/', pattern_type: 'contains', description: 'Axios HTTP' },
    { pattern: 'node-fetch', pattern_type: 'contains', description: 'Node Fetch' },
    { pattern: 'Go-http-client', pattern_type: 'contains', description: 'Go HTTP Client' },
    { pattern: 'Java/', pattern_type: 'contains', description: 'Java HTTP Client' },
    { pattern: 'libwww-perl', pattern_type: 'contains', description: 'Perl LWP' },
    { pattern: 'scrapy', pattern_type: 'contains', description: 'Scrapy' },
  ];

  for (const item of patterns) {
    const existing = queryOne<{ id: number }>(
      'SELECT id FROM blacklist_uas WHERE user_id IS NULL AND pattern = ?',
      [item.pattern]
    );

    if (!existing) {
      execute(
        `INSERT INTO blacklist_uas (user_id, pattern, pattern_type, description, source, is_active)
         VALUES (NULL, ?, ?, ?, 'builtin', 1)`,
        [item.pattern, item.pattern_type, item.description]
      );
    }
  }

  console.log(`Seeded ${patterns.length} default UA blacklist patterns`);
}

/**
 * 种子数据 - 默认 ISP 黑名单 (数据中心)
 */
function seedDefaultISPBlacklist(): void {
  const isps = [
    { asn: 'AS15169', isp_name: 'Google LLC', reason: 'Google Cloud' },
    { asn: 'AS14618', isp_name: 'Amazon.com, Inc.', reason: 'AWS' },
    { asn: 'AS8075', isp_name: 'Microsoft Corporation', reason: 'Azure' },
    { asn: 'AS13335', isp_name: 'Cloudflare, Inc.', reason: 'Cloudflare' },
    { asn: 'AS16509', isp_name: 'Amazon.com, Inc.', reason: 'AWS EC2' },
    { asn: 'AS14061', isp_name: 'DigitalOcean, LLC', reason: 'DigitalOcean' },
    { asn: 'AS63949', isp_name: 'Linode, LLC', reason: 'Linode' },
    { asn: 'AS20473', isp_name: 'Vultr Holdings LLC', reason: 'Vultr' },
    { asn: 'AS45102', isp_name: 'Alibaba (US) Technology Co., Ltd.', reason: 'Alibaba Cloud' },
    { asn: 'AS132203', isp_name: 'Tencent Building', reason: 'Tencent Cloud' },
    { asn: 'AS36351', isp_name: 'SoftLayer Technologies Inc.', reason: 'IBM Cloud' },
    { asn: 'AS19551', isp_name: 'Incapsula Inc', reason: 'Imperva' },
    { asn: 'AS54113', isp_name: 'Fastly, Inc.', reason: 'Fastly CDN' },
    { asn: 'AS16625', isp_name: 'Akamai Technologies, Inc.', reason: 'Akamai' },
    { asn: 'AS12876', isp_name: 'SCALEWAY S.A.S.', reason: 'Scaleway' },
    { asn: 'AS24940', isp_name: 'Hetzner Online GmbH', reason: 'Hetzner' },
    { asn: 'AS51167', isp_name: 'Contabo GmbH', reason: 'Contabo' },
  ];

  for (const isp of isps) {
    const existing = queryOne<{ id: number }>(
      'SELECT id FROM blacklist_isps WHERE user_id IS NULL AND asn = ?',
      [isp.asn]
    );

    if (!existing) {
      execute(
        `INSERT INTO blacklist_isps (user_id, asn, isp_name, reason, source, is_active)
         VALUES (NULL, ?, ?, ?, 'builtin', 1)`,
        [isp.asn, isp.isp_name, isp.reason]
      );
    }
  }

  console.log(`Seeded ${isps.length} default ISP blacklist entries`);
}

/**
 * 种子数据 - 默认 Prompt 模板
 */
function seedDefaultPrompts(): void {
  const prompts = [
    {
      name: 'safe_page_review',
      category: 'safe_page_review',
      description: '产品对比评测页面生成',
      content: `你是一位专业的产品评测作家。请根据以下信息生成一篇客观、专业的产品对比评测文章。

**品牌信息：**
- 主推品牌：{{brand_name}}
- 品牌官网：{{brand_url}}
- 品牌描述：{{brand_description}}

**竞品信息：**
{{competitors}}

**要求：**
1. 文章长度：1500-2500 字
2. 结构包含：摘要、功能对比、价格对比、优缺点分析、结论推荐
3. 语气客观，避免过度营销
4. 在适当位置自然插入 CTA（使用 [CTA_BUTTON] 标记）
5. 突出主推品牌的优势，但不贬低竞品
6. 使用 Markdown 格式

**输出语言：** {{target_language}}`,
    },
    {
      name: 'safe_page_tips',
      category: 'safe_page_tips',
      description: '使用技巧页面生成',
      content: `你是一位专业的产品教程作家。请根据以下信息生成一篇实用的产品使用技巧文章。

**品牌信息：**
- 品牌名称：{{brand_name}}
- 品牌描述：{{brand_description}}

**要求：**
1. 文章长度：1200-2000 字
2. 包含 5-10 个实用技巧
3. 每个技巧配有简要说明和操作步骤
4. 在文章开头和结尾自然插入 CTA（使用 [CTA_BUTTON] 标记）
5. 语气亲切、易懂
6. 使用 Markdown 格式，包含合适的标题层级

**输出语言：** {{target_language}}`,
    },
    {
      name: 'safe_page_title',
      category: 'safe_page_common',
      description: '页面标题生成',
      content: `为以下产品生成一个 SEO 友好的页面标题（60 字符以内）：

产品名称：{{brand_name}}
页面类型：{{page_type}}

要求：
1. 包含产品名称
2. 吸引点击
3. 适合搜索引擎优化`,
    },
    {
      name: 'safe_page_meta',
      category: 'safe_page_common',
      description: 'Meta 描述生成',
      content: `为以下产品页面生成 Meta 描述（160 字符以内）：

产品名称：{{brand_name}}
产品描述：{{brand_description}}
页面类型：{{page_type}}

要求：
1. 简洁有力
2. 包含关键信息
3. 吸引用户点击`,
    },
  ];

  for (const prompt of prompts) {
    const existing = queryOne<{ id: number }>(
      'SELECT id FROM prompts WHERE name = ?',
      [prompt.name]
    );

    if (!existing) {
      // 创建 prompt
      execute(
        `INSERT INTO prompts (name, description, category, is_active)
         VALUES (?, ?, ?, 1)`,
        [prompt.name, prompt.description, prompt.category]
      );

      const newPrompt = queryOne<{ id: number }>(
        'SELECT id FROM prompts WHERE name = ?',
        [prompt.name]
      );

      if (newPrompt) {
        // 创建初始版本
        execute(
          `INSERT INTO prompt_versions (prompt_id, version, content, is_active)
           VALUES (?, 1, ?, 1)`,
          [newPrompt.id, prompt.content]
        );

        // 更新 active_version_id
        const versionId = queryOne<{ id: number }>(
          'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = 1',
          [newPrompt.id]
        );

        if (versionId) {
          execute(
            'UPDATE prompts SET active_version_id = ? WHERE id = ?',
            [versionId.id, newPrompt.id]
          );
        }
      }

      console.log(`Created prompt: ${prompt.name}`);
    }
  }

  console.log(`Seeded ${prompts.length} default prompts`);
}

/**
 * 运行所有种子数据
 */
export async function seed(): Promise<void> {
  console.log('Running database seeds...');

  // 确保数据库已初始化
  getDatabase();

  await seedAdminUser();
  seedBlacklistSources();
  seedDefaultUABlacklist();
  seedDefaultISPBlacklist();
  seedDefaultPrompts();

  console.log('Database seeding completed.');
}

// 如果直接运行此文件，则执行种子
if (import.meta.url === `file://${process.argv[1]}`) {
  seed().catch(console.error);
}
