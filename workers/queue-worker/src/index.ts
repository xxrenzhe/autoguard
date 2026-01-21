/**
 * Queue Worker
 * 处理页面生成队列任务
 * - 页面抓取 (scrape)
 * - AI 页面生成 (ai_generate)
 */

import {
  getRedis,
  CacheKeys,
  queryOne,
  execute,
  safeJsonParse,
  Settings,
} from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import {
  scrapePage,
  generateSafePage,
  savePageWithProcessedPaths,
  getPageDir,
  ensureDir,
} from '@autoguard/page-generator';

// 配置
const POLL_INTERVAL = parseInt(process.env.QUEUE_POLL_INTERVAL || '1000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10);
const MAX_JOB_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.PAGE_GENERATION_MAX_ATTEMPTS || '3', 10) || 3
);

// 任务状态
interface JobStatus {
  running: number;
  completed: number;
  failed: number;
  retried: number;
  dead: number;
}

const jobStatus: JobStatus = {
  running: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  dead: 0,
};

// 任务接口
interface PageGenerationJob {
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

/**
 * 处理页面生成任务
 */
async function processJob(
  job: PageGenerationJob,
  options: { finalAttempt: boolean }
): Promise<void> {
  const { pageId, offerId, variant, action, sourceUrl, subdomain, affiliateLink, competitors } = job;
  const attempt = typeof job.attempt === 'number' ? job.attempt : 0;

  console.log(
    `[Queue] Processing job: pageId=${pageId}, variant=${variant}, action=${action}, attempt=${attempt + 1}/${MAX_JOB_ATTEMPTS}`
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
    jobStatus.completed++;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Queue] Job failed: pageId=${pageId}, attempt=${attempt + 1}/${MAX_JOB_ATTEMPTS}, error=${errorMessage}`
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

    jobStatus.failed++;
    throw new Error(errorMessage);
  }
}

async function acknowledgeJob(
  redis: ReturnType<typeof getRedis>,
  processingKey: string,
  rawJobData: string
): Promise<void> {
  try {
    await redis.lrem(processingKey, 1, rawJobData);
  } catch (error) {
    console.error('[Queue] Failed to acknowledge job:', error);
  }
}

async function requeueStuckJobs(
  redis: ReturnType<typeof getRedis>,
  processingKey: string,
  queueKey: string
): Promise<void> {
  let moved = 0;
  while (true) {
    const jobData = await redis.rpoplpush(processingKey, queueKey);
    if (!jobData) break;
    moved++;
  }
  if (moved > 0) {
    console.warn(`[Queue] Re-queued ${moved} stuck jobs from processing list`);
  }
}

/**
 * 从队列获取任务
 */
async function pollQueue(): Promise<void> {
  const redis = getRedis();
  const queueKey = CacheKeys.queue.pageGeneration;
  const processingKey = `${queueKey}:processing`;
  const deadKey = `${queueKey}:dead`;

  // 进程重启后，将遗留在 processing 的任务放回 pending
  await requeueStuckJobs(redis, processingKey, queueKey);

  while (true) {
    try {
      // 检查并发限制
      if (jobStatus.running >= MAX_CONCURRENT_JOBS) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // 从队列获取任务（阻塞等待），并放入 processing 列表，避免进程崩溃导致任务丢失
      const jobData = await redis.brpoplpush(queueKey, processingKey, 5);
      if (!jobData) continue;

      const job = safeJsonParse<PageGenerationJob | null>(jobData, null);

      if (!job) {
        console.error('[Queue] Invalid job data:', jobData);
        await acknowledgeJob(redis, processingKey, jobData);
        continue;
      }

      const attempt = typeof job.attempt === 'number' ? job.attempt : 0;
      const finalAttempt = attempt + 1 >= MAX_JOB_ATTEMPTS;

      // 启动任务处理（不等待完成）
      jobStatus.running++;
      (async () => {
        try {
          await processJob(job, { finalAttempt });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);

          if (!finalAttempt) {
            const nextAttempt = attempt + 1;
            const retryJob: PageGenerationJob = {
              ...job,
              attempt: nextAttempt,
            };

            try {
              // 推到队尾，避免立即重复消费
              await redis.rpush(queueKey, JSON.stringify(retryJob));
              jobStatus.retried++;
              console.warn(
                `[Queue] Re-queued job for retry: pageId=${job.pageId} attempt=${nextAttempt}/${MAX_JOB_ATTEMPTS}`
              );
            } catch (pushError) {
              console.error('[Queue] Failed to re-queue job:', pushError);
            }
          } else {
            // 超过最大重试次数：进入 DLQ，便于排查/手动重放
            try {
              await redis.lpush(
                deadKey,
                JSON.stringify({
                  ...job,
                  attempt,
                  failedAt: new Date().toISOString(),
                  error: errorMessage,
                })
              );
              jobStatus.dead++;
              console.error(`[Queue] Job moved to DLQ: pageId=${job.pageId}`);
            } catch (pushError) {
              console.error('[Queue] Failed to push job to DLQ:', pushError);
            }
          }
        } finally {
          jobStatus.running--;
          await acknowledgeJob(redis, processingKey, jobData);
        }
      })().catch((err) => {
        console.error('[Queue] Unhandled error in job wrapper:', err);
      });
    } catch (error) {
      console.error('[Queue] Poll error:', error);
      await sleep(POLL_INTERVAL);
    }
  }
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 获取状态
 */
function getStatus(): Record<string, unknown> {
  return {
    uptime: process.uptime(),
    jobs: jobStatus,
    config: {
      pollInterval: POLL_INTERVAL,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    },
  };
}

/**
 * 优雅关闭
 */
function gracefulShutdown(): void {
  console.log('[Queue] Shutting down...');

  // 等待当前任务完成
  const checkRunning = setInterval(() => {
    if (jobStatus.running === 0) {
      clearInterval(checkRunning);
      process.exit(0);
    }
  }, 100);

  // 最多等待 30 秒
  setTimeout(() => {
    console.log('[Queue] Force shutdown');
    process.exit(1);
  }, 30000);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

/**
 * 启动
 */
async function start(): Promise<void> {
  console.log('[Queue] Starting queue worker...');
  console.log(`[Queue] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[Queue] Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);

  // 定期打印状态
  setInterval(() => {
    console.log('[Queue] Status:', JSON.stringify(getStatus(), null, 2));
  }, 60000);

  // 开始轮询队列
  await pollQueue();
}

start().catch((err) => {
  console.error('[Queue] Failed to start:', err);
  process.exit(1);
});
