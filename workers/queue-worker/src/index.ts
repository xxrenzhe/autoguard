/**
 * Queue Worker
 * 处理页面生成队列任务
 * - 页面抓取 (scrape)
 * - AI 页面生成 (ai_generate)
 */

import { getRedis, CacheKeys, safeJsonParse } from '@autoguard/shared';
import { processPageGenerationJob } from './process-job';
import type { PageGenerationJob } from './process-job';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

// 配置
const POLL_INTERVAL = parseInt(process.env.QUEUE_POLL_INTERVAL || '1000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10);
const MAX_JOB_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.PAGE_GENERATION_MAX_ATTEMPTS || '3', 10) || 3
);

const RETRY_BASE_DELAY_MS = Math.max(0, envInt('PAGE_GENERATION_RETRY_BASE_DELAY_MS', 2000));
const RETRY_MAX_DELAY_MS = Math.max(
  RETRY_BASE_DELAY_MS,
  envInt('PAGE_GENERATION_RETRY_MAX_DELAY_MS', 60000)
);
const RETRY_JITTER_RATIO = Math.min(1, Math.max(0, envFloat('PAGE_GENERATION_RETRY_JITTER_RATIO', 0.2)));
const DELAYED_MOVE_INTERVAL_MS = Math.max(250, envInt('PAGE_GENERATION_DELAYED_POLL_INTERVAL', 1000));
const DELAYED_MOVE_BATCH_SIZE = Math.max(1, envInt('PAGE_GENERATION_DELAYED_BATCH_SIZE', 50));
const QUEUE_METRICS_INTERVAL_MS = Math.max(500, envInt('QUEUE_METRICS_INTERVAL', 5000));

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

type QueueMetrics = {
  pending: number;
  processing: number;
  delayed: number;
  dead: number;
  updatedAt: string | null;
};

const queueMetrics: QueueMetrics = {
  pending: 0,
  processing: 0,
  delayed: 0,
  dead: 0,
  updatedAt: null,
};

let delayedMoverTimer: NodeJS.Timeout | null = null;
let metricsRefresherTimer: NodeJS.Timeout | null = null;

const MOVE_DUE_DELAYED_JOBS_LUA = `
local zsetKey = KEYS[1]
local queueKey = KEYS[2]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local items = redis.call('ZRANGEBYSCORE', zsetKey, '-inf', now, 'LIMIT', 0, limit)
if #items == 0 then
  return 0
end

redis.call('ZREM', zsetKey, unpack(items))
for i = 1, #items do
  redis.call('LPUSH', queueKey, items[i])
end
return #items
`;

function calculateRetryDelayMs(nextAttempt: number): number {
  const exponential = Math.pow(2, Math.max(0, nextAttempt - 1));
  const baseDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * exponential);
  if (RETRY_JITTER_RATIO <= 0) return Math.round(baseDelay);

  const jitter = baseDelay * RETRY_JITTER_RATIO;
  const randomized = baseDelay + (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(Math.min(RETRY_MAX_DELAY_MS, randomized)));
}

async function moveDueDelayedJobs(
  redis: ReturnType<typeof getRedis>,
  delayedKey: string,
  queueKey: string
): Promise<number> {
  const moved = await redis.eval(
    MOVE_DUE_DELAYED_JOBS_LUA,
    2,
    delayedKey,
    queueKey,
    Date.now(),
    DELAYED_MOVE_BATCH_SIZE
  );
  return Number(moved) || 0;
}

async function refreshQueueMetrics(
  redis: ReturnType<typeof getRedis>,
  keys: { queueKey: string; processingKey: string; delayedKey: string; deadKey: string }
): Promise<void> {
  const [pending, processing, delayed, dead] = await Promise.all([
    redis.llen(keys.queueKey),
    redis.llen(keys.processingKey),
    redis.zcard(keys.delayedKey),
    redis.llen(keys.deadKey),
  ]);

  queueMetrics.pending = pending;
  queueMetrics.processing = processing;
  queueMetrics.delayed = delayed;
  queueMetrics.dead = dead;
  queueMetrics.updatedAt = new Date().toISOString();
}

/**
 * 从 processing 列表中确认（ack）任务，避免重复处理
 */
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
async function pollQueue(redis: ReturnType<typeof getRedis>): Promise<void> {
  const queueKey = CacheKeys.queue.pageGeneration;
  const processingKey = `${queueKey}:processing`;
  const delayedKey = `${queueKey}:delayed`;
  const deadKey = `${queueKey}:dead`;

  // 进程重启后，将遗留在 processing 的任务放回 pending
  await requeueStuckJobs(redis, processingKey, queueKey);

  // 启动时先搬一次到期的 delayed job，避免延迟队列积压
  try {
    const moved = await moveDueDelayedJobs(redis, delayedKey, queueKey);
    if (moved > 0) {
      console.warn(`[Queue] Moved ${moved} delayed jobs to pending on startup`);
    }
  } catch (error) {
    console.error('[Queue] Failed to move delayed jobs on startup:', error);
  }

  // 周期性搬运 delayed -> pending（持久化延迟重试，避免进程内 setTimeout 丢任务）
  if (delayedMoverTimer) clearInterval(delayedMoverTimer);
  delayedMoverTimer = setInterval(() => {
    moveDueDelayedJobs(redis, delayedKey, queueKey)
      .then((moved) => {
        if (moved > 0) {
          console.log(`[Queue] Moved ${moved} delayed jobs to pending`);
        }
      })
      .catch((error) => {
        console.error('[Queue] Failed to move delayed jobs:', error);
      });
  }, DELAYED_MOVE_INTERVAL_MS);

  // 周期性刷新队列长度，便于日志/面板查看
  if (metricsRefresherTimer) clearInterval(metricsRefresherTimer);
  metricsRefresherTimer = setInterval(() => {
    refreshQueueMetrics(redis, { queueKey, processingKey, delayedKey, deadKey }).catch((error) => {
      console.error('[Queue] Failed to refresh queue metrics:', error);
    });
  }, QUEUE_METRICS_INTERVAL_MS);

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
          await processPageGenerationJob(job, { finalAttempt, maxAttempts: MAX_JOB_ATTEMPTS });
          jobStatus.completed++;
        } catch (err) {
          jobStatus.failed++;
          const errorMessage = err instanceof Error ? err.message : String(err);

          if (!finalAttempt) {
            const nextAttempt = attempt + 1;
            const delayMs = calculateRetryDelayMs(nextAttempt);
            const retryJob: PageGenerationJob = {
              ...job,
              attempt: nextAttempt,
            };

            try {
              await redis.zadd(delayedKey, Date.now() + delayMs, JSON.stringify(retryJob));
              jobStatus.retried++;
              console.warn(
                `[Queue] Scheduled job retry: pageId=${job.pageId} attempt=${nextAttempt}/${MAX_JOB_ATTEMPTS} delayMs=${delayMs}`
              );
            } catch (pushError) {
              // 兜底：延迟队列失败时回退到普通队列（避免任务丢失）
              console.error('[Queue] Failed to schedule retry (fallback to queue):', pushError);
              try {
                await redis.lpush(queueKey, JSON.stringify(retryJob));
                jobStatus.retried++;
              } catch (fallbackError) {
                console.error('[Queue] Failed to fallback re-queue job:', fallbackError);
              }
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
    queue: queueMetrics,
    config: {
      pollInterval: POLL_INTERVAL,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      retry: {
        maxAttempts: MAX_JOB_ATTEMPTS,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        maxDelayMs: RETRY_MAX_DELAY_MS,
        jitterRatio: RETRY_JITTER_RATIO,
        delayedPollIntervalMs: DELAYED_MOVE_INTERVAL_MS,
        delayedBatchSize: DELAYED_MOVE_BATCH_SIZE,
        metricsIntervalMs: QUEUE_METRICS_INTERVAL_MS,
      },
    },
  };
}

/**
 * 优雅关闭
 */
function gracefulShutdown(): void {
  console.log('[Queue] Shutting down...');

  if (delayedMoverTimer) {
    clearInterval(delayedMoverTimer);
    delayedMoverTimer = null;
  }

  if (metricsRefresherTimer) {
    clearInterval(metricsRefresherTimer);
    metricsRefresherTimer = null;
  }

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
  console.log(
    `[Queue] Retry: maxAttempts=${MAX_JOB_ATTEMPTS} baseDelayMs=${RETRY_BASE_DELAY_MS} maxDelayMs=${RETRY_MAX_DELAY_MS} jitterRatio=${RETRY_JITTER_RATIO}`
  );

  const redis = getRedis();

  // 立即刷新一次队列长度，便于启动日志对齐
  try {
    const queueKey = CacheKeys.queue.pageGeneration;
    await refreshQueueMetrics(redis, {
      queueKey,
      processingKey: `${queueKey}:processing`,
      delayedKey: `${queueKey}:delayed`,
      deadKey: `${queueKey}:dead`,
    });
  } catch (error) {
    console.error('[Queue] Failed to refresh queue metrics on startup:', error);
  }

  // 定期打印状态
  setInterval(() => {
    console.log('[Queue] Status:', JSON.stringify(getStatus(), null, 2));
  }, 60000);

  // 开始轮询队列
  await pollQueue(redis);
}

start().catch((err) => {
  console.error('[Queue] Failed to start:', err);
  process.exit(1);
});
