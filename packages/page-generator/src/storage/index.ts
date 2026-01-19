/**
 * 页面存储管理
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const PAGES_DIR = process.env.PAGES_DIR || '/data/pages';

/**
 * 页面存储路径结构
 * /data/pages/{subdomain}/
 *   ├── a/                    # Money Page
 *   │   ├── index.html
 *   │   └── assets/
 *   └── b/                    # Safe Page
 *       ├── index.html
 *       └── assets/
 */

/**
 * 获取页面目录路径
 */
export function getPageDir(subdomain: string, variant: 'a' | 'b'): string {
  return path.join(PAGES_DIR, subdomain, variant);
}

/**
 * 获取页面 HTML 路径
 */
export function getPageHtmlPath(subdomain: string, variant: 'a' | 'b'): string {
  return path.join(getPageDir(subdomain, variant), 'index.html');
}

/**
 * 获取资源目录路径
 */
export function getAssetsDir(subdomain: string, variant: 'a' | 'b'): string {
  return path.join(getPageDir(subdomain, variant), 'assets');
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 保存页面 HTML
 */
export async function savePageHtml(
  subdomain: string,
  variant: 'a' | 'b',
  html: string
): Promise<void> {
  const pageDir = getPageDir(subdomain, variant);
  await ensureDir(pageDir);

  const htmlPath = path.join(pageDir, 'index.html');
  await fs.writeFile(htmlPath, html, 'utf-8');
}

/**
 * 读取页面 HTML
 */
export async function readPageHtml(
  subdomain: string,
  variant: 'a' | 'b'
): Promise<string | null> {
  const htmlPath = getPageHtmlPath(subdomain, variant);

  try {
    return await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 检查页面是否存在
 */
export function pageExists(subdomain: string, variant: 'a' | 'b'): boolean {
  const htmlPath = getPageHtmlPath(subdomain, variant);
  return existsSync(htmlPath);
}

/**
 * 删除页面目录
 */
export async function deletePage(subdomain: string, variant?: 'a' | 'b'): Promise<void> {
  if (variant) {
    const pageDir = getPageDir(subdomain, variant);
    await fs.rm(pageDir, { recursive: true, force: true });
  } else {
    // 删除整个 subdomain 目录
    const subdomainDir = path.join(PAGES_DIR, subdomain);
    await fs.rm(subdomainDir, { recursive: true, force: true });
  }
}

/**
 * 列出所有 subdomain
 */
export async function listSubdomains(): Promise<string[]> {
  try {
    const entries = await fs.readdir(PAGES_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * 获取页面信息
 */
export async function getPageInfo(
  subdomain: string,
  variant: 'a' | 'b'
): Promise<{
  exists: boolean;
  htmlPath: string;
  assetsDir: string;
  lastModified?: Date;
}> {
  const htmlPath = getPageHtmlPath(subdomain, variant);
  const assetsDir = getAssetsDir(subdomain, variant);
  const exists = existsSync(htmlPath);

  let lastModified: Date | undefined;
  if (exists) {
    try {
      const stats = await fs.stat(htmlPath);
      lastModified = stats.mtime;
    } catch {
      // 忽略错误
    }
  }

  return {
    exists,
    htmlPath,
    assetsDir,
    lastModified,
  };
}

/**
 * 处理 HTML 中的资源路径
 * 将相对路径替换为 /static/{subdomain}/{variant}/assets/ 格式
 */
export function processHtmlAssetPaths(
  html: string,
  subdomain: string,
  variant: 'a' | 'b'
): string {
  const staticPrefix = `/static/${subdomain}/${variant}`;

  // 替换 href="assets/..."
  html = html.replace(
    /href="assets\//g,
    `href="${staticPrefix}/assets/`
  );

  // 替换 src="assets/..."
  html = html.replace(
    /src="assets\//g,
    `src="${staticPrefix}/assets/`
  );

  // 替换 url(assets/...)
  html = html.replace(
    /url\(["']?assets\//g,
    `url(${staticPrefix}/assets/`
  );

  // 替换 url('assets/...)
  html = html.replace(
    /url\(['"]assets\//g,
    `url('${staticPrefix}/assets/`
  );

  return html;
}

/**
 * 保存页面（带资源路径处理）
 */
export async function savePageWithProcessedPaths(
  subdomain: string,
  variant: 'a' | 'b',
  html: string
): Promise<void> {
  const processedHtml = processHtmlAssetPaths(html, subdomain, variant);
  await savePageHtml(subdomain, variant, processedHtml);
}
