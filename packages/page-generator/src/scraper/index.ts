/**
 * 网页抓取器
 * 使用 Playwright + Stealth 抓取目标网页
 */

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { sleep } from '@autoguard/shared';
import { rewriteLinks } from './rewrite-links';

// 启用 stealth 插件
chromium.use(stealth());

function resolveChromiumExecutablePath(): string | undefined {
  const envPath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;

  if (envPath) {
    if (existsSync(envPath)) return envPath;
    console.warn(`[Scraper] Chromium executable not found at: ${envPath}`);
  }

  const candidates = ['/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

/**
 * 抓取配置
 */
export interface ScrapeConfig {
  url: string;
  outputDir: string;
  timeout?: number;
  waitForSelector?: string;
  disableJavaScript?: boolean;
  proxy?: string;
  userAgent?: string;
  affiliateLink?: string; // Affiliate link to replace all links with
}

/**
 * 抓取结果
 */
export interface ScrapeResult {
  success: boolean;
  html?: string;
  title?: string;
  description?: string;
  assets: AssetInfo[];
  errors: string[];
  resourceDownloadRate: number;
}

/**
 * 资源信息
 */
export interface AssetInfo {
  originalUrl: string;
  localPath: string;
  type: 'css' | 'js' | 'image' | 'font' | 'other';
  downloaded: boolean;
  error?: string;
}

/**
 * 抓取网页
 */
export async function scrapePage(config: ScrapeConfig): Promise<ScrapeResult> {
  const {
    url,
    outputDir,
    timeout = 30000,
    waitForSelector,
    disableJavaScript = false,
    proxy,
    userAgent,
    affiliateLink,
  } = config;

  const result: ScrapeResult = {
    success: false,
    assets: [],
    errors: [],
    resourceDownloadRate: 0,
  };

  let browser;

  try {
    const executablePath = resolveChromiumExecutablePath();

    // 启动浏览器
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent:
        userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      javaScriptEnabled: !disableJavaScript,
      ...(proxy && { proxy: { server: proxy } }),
    });

    const page = await context.newPage();

    // 收集资源 URL
    const resourceUrls: Set<string> = new Set();

    page.on('response', async (response) => {
      const resourceUrl = response.url();
      const contentType = response.headers()['content-type'] || '';

      if (
        contentType.includes('text/css') ||
        contentType.includes('javascript') ||
        contentType.includes('image/') ||
        contentType.includes('font/')
      ) {
        resourceUrls.add(resourceUrl);
      }
    });

    // 访问页面
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    // 等待特定选择器（如果指定）
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
    }

    // 额外等待确保页面加载完成
    await sleep(2000);

    // 获取页面 HTML
    const html = await page.content();
    result.html = html;

    // 提取标题和描述
    result.title = await page.title();
    result.description = await page
      .locator('meta[name="description"]')
      .getAttribute('content')
      .catch(() => null) || undefined;

    // 创建输出目录
    const assetsDir = path.join(outputDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    // 下载资源
    const downloadedCount = await downloadAssets(
      Array.from(resourceUrls),
      assetsDir,
      url,
      result.assets
    );

    // 计算下载率
    result.resourceDownloadRate =
      resourceUrls.size > 0 ? downloadedCount / resourceUrls.size : 1;

    // 处理 HTML - 替换资源路径
    let processedHtml = processHtml(html, url, result.assets);

    // 如果提供了推广链接，重写所有链接
    if (affiliateLink) {
      processedHtml = rewriteLinks(processedHtml, affiliateLink);
    }

    // 保存处理后的 HTML
    await fs.writeFile(path.join(outputDir, 'index.html'), processedHtml, 'utf-8');

    result.success = true;
    result.html = processedHtml;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    console.error('Scrape error:', errorMessage);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return result;
}

/**
 * 下载资源
 */
async function downloadAssets(
  urls: string[],
  outputDir: string,
  baseUrl: string,
  assets: AssetInfo[]
): Promise<number> {
  let downloadedCount = 0;

  for (const resourceUrl of urls) {
    const assetInfo: AssetInfo = {
      originalUrl: resourceUrl,
      localPath: '',
      type: getAssetType(resourceUrl),
      downloaded: false,
    };

    try {
      // 解析 URL
      const parsedUrl = new URL(resourceUrl);
      const fileName = generateFileName(parsedUrl);
      const localPath = path.join(outputDir, fileName);

      // 下载资源
      const response = await fetch(resourceUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: baseUrl,
        },
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        await fs.writeFile(localPath, Buffer.from(buffer));

        assetInfo.localPath = `assets/${fileName}`;
        assetInfo.downloaded = true;
        downloadedCount++;
      } else {
        assetInfo.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      assetInfo.error = error instanceof Error ? error.message : String(error);
    }

    assets.push(assetInfo);
  }

  return downloadedCount;
}

/**
 * 获取资源类型
 */
function getAssetType(url: string): AssetInfo['type'] {
  const ext = path.extname(new URL(url).pathname).toLowerCase();

  if (['.css'].includes(ext)) return 'css';
  if (['.js'].includes(ext)) return 'js';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext))
    return 'image';
  if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) return 'font';

  return 'other';
}

/**
 * 生成文件名
 */
function generateFileName(url: URL): string {
  const pathname = url.pathname;
  const baseName = path.basename(pathname) || 'resource';
  const ext = path.extname(pathname);

  // 添加 hash 避免冲突
  const hash = Buffer.from(url.href).toString('base64').slice(0, 8);

  if (ext) {
    return `${path.basename(baseName, ext)}_${hash}${ext}`;
  }

  return `${baseName}_${hash}`;
}

/**
 * 处理 HTML - 替换资源路径
 */
function processHtml(html: string, baseUrl: string, assets: AssetInfo[]): string {
  const $ = cheerio.load(html);

  // 创建 URL 到本地路径的映射
  const urlMap = new Map<string, string>();
  for (const asset of assets) {
    if (asset.downloaded && asset.localPath) {
      urlMap.set(asset.originalUrl, asset.localPath);
    }
  }

  // 替换 link href
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const absoluteUrl = new URL(href, baseUrl).href;
      const localPath = urlMap.get(absoluteUrl);
      if (localPath) {
        $(el).attr('href', localPath);
      }
    }
  });

  // 替换 script src
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      const absoluteUrl = new URL(src, baseUrl).href;
      const localPath = urlMap.get(absoluteUrl);
      if (localPath) {
        $(el).attr('src', localPath);
      }
    }
  });

  // 替换 img src
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      const absoluteUrl = new URL(src, baseUrl).href;
      const localPath = urlMap.get(absoluteUrl);
      if (localPath) {
        $(el).attr('src', localPath);
      }
    }
  });

  // 替换 CSS 中的 url()（简化处理）
  $('style').each((_, el) => {
    let cssContent = $(el).html();
    if (cssContent) {
      for (const [originalUrl, localPath] of urlMap) {
        cssContent = cssContent.replace(
          new RegExp(escapeRegExp(originalUrl), 'g'),
          localPath
        );
      }
      $(el).html(cssContent);
    }
  });

  return $.html();
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 降级抓取（无 Stealth）
 */
export async function scrapePageSimple(
  url: string,
  outputDir: string
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    success: false,
    assets: [],
    errors: [],
    resourceDownloadRate: 0,
  };

  try {
    // 简单 HTTP 请求
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      result.errors.push(`HTTP ${response.status}`);
      return result;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    result.title = $('title').text();
    result.description = $('meta[name="description"]').attr('content');
    result.html = html;

    // 保存 HTML
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf-8');

    result.success = true;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}
