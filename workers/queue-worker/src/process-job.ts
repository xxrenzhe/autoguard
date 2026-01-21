/**
 * Page Generation Job Processor
 * 负责执行单个页面生成任务（抓取/AI 生成 + 保存 + DB 状态更新）
 */

import { queryOne, execute, Settings } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import {
  scrapePage,
  generateSafePage,
  savePageWithProcessedPaths,
  getPageDir,
  ensureDir,
} from '@autoguard/page-generator';

export interface PageGenerationJob {
  pageId: number;
  offerId: number;
  variant: 'a' | 'b';
  action: 'scrape' | 'ai_generate';
  sourceUrl: string;
  subdomain: string;
  safePageType?: 'review' | 'tips' | 'comparison' | 'guide';
  affiliateLink?: string;
  competitors?: string[];
  attempt?: number;
}

export async function processPageGenerationJob(
  job: PageGenerationJob,
  options: { finalAttempt: boolean; maxAttempts: number }
): Promise<void> {
  const { pageId, offerId, variant, action, sourceUrl, subdomain, affiliateLink, competitors } =
    job;
  const attempt = typeof job.attempt === 'number' ? job.attempt : 0;

  console.log(
    `[Queue] Processing job: pageId=${pageId}, variant=${variant}, action=${action}, attempt=${attempt + 1}/${options.maxAttempts}`
  );

  try {
    let html: string;

    if (action === 'scrape') {
      // 抓取页面
      const outputDir = getPageDir(subdomain, variant);
      await ensureDir(outputDir);

      const offer = queryOne<Pick<Offer, 'user_id'>>(
        'SELECT user_id FROM offers WHERE id = ?',
        [offerId]
      );

      const proxyEnabled = offer ? Settings.isProxyEnabled(offer.user_id) : false;
      const proxyUrl = offer ? Settings.getProxyUrl(offer.user_id) : null;
      const proxy = proxyEnabled ? proxyUrl || undefined : undefined;

      if (proxyEnabled && !proxyUrl) {
        console.warn(`[Queue] Proxy enabled but proxy_url is empty: offerId=${offerId}`);
      }

      const result = await scrapePage({
        url: sourceUrl,
        outputDir,
        affiliateLink: affiliateLink,
        proxy,
        timeout: 30000,
      });

      if (!result.success || !result.html) {
        throw new Error(result.errors.join(', ') || 'Scrape failed');
      }

      html = result.html;

      // 更新 offer 抓取状态
      if (variant === 'a') {
        execute(
          `UPDATE offers SET
            scrape_status = 'completed',
            scraped_at = CURRENT_TIMESTAMP,
            page_title = ?,
            page_description = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [result.title || null, result.description || null, offerId]
        );
      }
    } else {
      // AI 生成 Safe Page
      const safePageType = job.safePageType || 'review';

      // 获取 offer 信息
      const offer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);
      if (!offer) {
        throw new Error('Offer not found');
      }

      // 用户级 AI 配置（优先）→ 全局设置（回退）→ 环境变量（最终回退由 page-generator 内部处理）
      const geminiApiKey = Settings.getGeminiApiKey(offer.user_id) || undefined;
      const geminiModel = Settings.getGeminiModel(offer.user_id) || undefined;

      const result = await generateSafePage({
        brandName: offer.brand_name,
        brandUrl: offer.brand_url,
        pageType: safePageType,
        competitors: competitors || [],
        language: 'en',
        tone: 'professional',
        affiliateLink: offer.affiliate_link,
        apiKey: geminiApiKey,
        model: geminiModel,
      });

      if (!result.success || !result.html) {
        throw new Error(result.error || 'AI generation failed');
      }

      html = result.html;
    }

    // 保存页面（处理资源路径）
    await savePageWithProcessedPaths(subdomain, variant, html);

    // 更新页面状态为生成完成
    execute(
      `UPDATE pages SET
        status = 'generated',
        html_content = ?,
        generation_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [html, pageId]
    );

    console.log(`[Queue] Job completed: pageId=${pageId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Queue] Job failed: pageId=${pageId}, attempt=${attempt + 1}/${options.maxAttempts}, error=${errorMessage}`
    );

    if (options.finalAttempt) {
      // 最终失败：更新页面状态为失败
      execute(
        `UPDATE pages SET
          status = 'failed',
          generation_error = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [errorMessage, pageId]
      );

      // 如果是 money page 抓取最终失败，更新 offer 状态
      if (job.variant === 'a' && job.action === 'scrape') {
        execute(
          `UPDATE offers SET
            scrape_status = 'failed',
            scrape_error = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [errorMessage, offerId]
        );
      }
    } else {
      // 将失败信息写入 generation_error，但保持 generating，便于 UI 展示“重试中”
      execute(
        `UPDATE pages SET
          status = 'generating',
          generation_error = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [errorMessage, pageId]
      );

      // Money page 抓取失败但会重试：保持 scraping，记录错误
      if (job.variant === 'a' && job.action === 'scrape') {
        execute(
          `UPDATE offers SET
            scrape_status = 'scraping',
            scrape_error = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [errorMessage, offerId]
        );
      }
    }

    throw new Error(errorMessage);
  }
}

