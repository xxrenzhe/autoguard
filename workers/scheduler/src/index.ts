/**
 * Scheduler Worker
 * 定时任务调度器，负责周期性任务
 * - 黑名单同步 (DB -> Redis)
 * - 黑名单过期清理
 * - 每日统计聚合
 * - 外部黑名单源同步（手动触发队列）
 */

import {
  syncAllBlacklists,
  cleanupExpiredBlacklists,
  getRedis,
  CacheKeys,
  safeJsonParse,
  isValidIPv4,
  isValidCIDR,
} from '@autoguard/shared';
import Database from 'better-sqlite3';

// 配置
const BLACKLIST_SYNC_INTERVAL = parseInt(process.env.BLACKLIST_SYNC_INTERVAL || '300000', 10); // 5 分钟
const EXPIRY_CLEANUP_INTERVAL = parseInt(process.env.EXPIRY_CLEANUP_INTERVAL || '3600000', 10); // 1 小时
const STATS_AGGREGATION_INTERVAL = parseInt(process.env.STATS_AGGREGATION_INTERVAL || '300000', 10); // 5 分钟
const DB_PATH =
  process.env.SQLITE_DB_PATH ||
  process.env.DATABASE_PATH ||
  './data/db/autoguard.db';

// 任务状态
interface TaskStatus {
  lastRun: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
}

type TaskName = 'blacklistSync' | 'expiryCleanup' | 'statsAggregation';

const taskStatuses: Record<TaskName, TaskStatus> = {
  blacklistSync: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
  expiryCleanup: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
  statsAggregation: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
};

// 数据库连接
let db: Database.Database;

// 外部黑名单源同步队列（由 API 手动触发）
const BLACKLIST_SOURCE_SYNC_QUEUE = 'autoguard:queue:blacklist_sync';

/**
 * 初始化
 */
async function init(): Promise<void> {
  console.log('[Scheduler] Initializing...');

  // 初始化数据库
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  console.log('[Scheduler] Database connected');

  // 立即执行一次黑名单同步
  await runBlacklistSync();

  console.log('[Scheduler] Initialization complete');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 黑名单同步任务
 */
async function runBlacklistSync(): Promise<void> {
  const taskName: TaskName = 'blacklistSync';
  taskStatuses[taskName].lastRun = new Date();
  taskStatuses[taskName].runCount++;

  console.log('[Scheduler] Running blacklist sync...');

  try {
    const results = await syncAllBlacklists();
    taskStatuses[taskName].lastSuccess = new Date();
    taskStatuses[taskName].lastError = null;
    console.log('[Scheduler] Blacklist sync completed:', results);
  } catch (error) {
    taskStatuses[taskName].errorCount++;
    taskStatuses[taskName].lastError = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Scheduler] Blacklist sync failed:', error);
  }
}

type BlacklistSyncJob = {
  sourceId: number;
  sourceName?: string;
  sourceType?: string;
  url?: string | null;
  triggeredBy?: number;
  triggeredAt?: string;
};

function parseBlacklistSourceContent(text: string): {
  ips: Map<string, string | null>;
  cidrs: Map<string, string | null>;
} {
  const ips = new Map<string, string | null>();
  const cidrs = new Map<string, string | null>();

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;

    // 简单去掉行尾注释（仅支持 #）
    const content = line.split('#')[0]!.trim();
    if (!content) continue;

    // 支持 CSV: value,reason
    const [valueRaw, reasonRaw] = content.split(',');
    const value = (valueRaw || '').trim();
    if (!value) continue;

    const reason = (reasonRaw || '').trim() || null;

    if (isValidIPv4(value)) {
      if (!ips.has(value)) ips.set(value, reason);
      continue;
    }

    if (isValidCIDR(value)) {
      if (!cidrs.has(value)) cidrs.set(value, reason);
      continue;
    }
  }

  return { ips, cidrs };
}

async function syncBlacklistSourceById(sourceId: number): Promise<{ ipCount: number; cidrCount: number }> {
  const source = db
    .prepare(
      `SELECT id, name, source_type, url, is_active
       FROM blacklist_sources
       WHERE id = ?`
    )
    .get(sourceId) as
    | { id: number; name: string; source_type: string; url: string | null; is_active: number }
    | undefined;

  if (!source) {
    throw new Error('Blacklist source not found');
  }

  if (!source.is_active) {
    throw new Error('Blacklist source is not active');
  }

  if (!source.url) {
    throw new Error('Blacklist source URL is empty');
  }

  // 标记为 syncing
  db.prepare(
    `UPDATE blacklist_sources
     SET sync_status = 'syncing',
         sync_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(sourceId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let text: string;
  try {
    const resp = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AutoGuard/1.0 (+blacklist-sync)',
        Accept: 'text/plain,*/*',
      },
    });
    if (!resp.ok) {
      throw new Error(`Fetch failed: HTTP ${resp.status}`);
    }
    text = await resp.text();
  } finally {
    clearTimeout(timeout);
  }

  const { ips, cidrs } = parseBlacklistSourceContent(text);
  const sourceTag = `source:${source.id}`;

  const deleteOld = db.transaction(() => {
    db.prepare(`DELETE FROM blacklist_ips WHERE user_id IS NULL AND source = ?`).run(sourceTag);
    db.prepare(`DELETE FROM blacklist_ip_ranges WHERE user_id IS NULL AND source = ?`).run(sourceTag);

    const insertIp = db.prepare(
      `INSERT INTO blacklist_ips (user_id, ip_address, reason, source, is_active)
       VALUES (NULL, ?, ?, ?, 1)`
    );
    const insertCidr = db.prepare(
      `INSERT INTO blacklist_ip_ranges (user_id, cidr, reason, source, is_active)
       VALUES (NULL, ?, ?, ?, 1)`
    );

    for (const [ip, reason] of ips) {
      insertIp.run(ip, reason, sourceTag);
    }

    for (const [cidr, reason] of cidrs) {
      insertCidr.run(cidr, reason, sourceTag);
    }
  });

  deleteOld();

  // 刷新 Redis 缓存
  await syncAllBlacklists();

  // 标记为 success
  db.prepare(
    `UPDATE blacklist_sources
     SET last_sync_at = CURRENT_TIMESTAMP,
         sync_status = 'success',
         sync_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(sourceId);

  console.log(`[Scheduler] Blacklist source synced: id=${source.id} name=${source.name} ip=${ips.size} cidr=${cidrs.size}`);
  return { ipCount: ips.size, cidrCount: cidrs.size };
}

async function startBlacklistSourceSyncQueue(): Promise<void> {
  const redis = getRedis();
  const pendingKey = BLACKLIST_SOURCE_SYNC_QUEUE;
  const processingKey = `${pendingKey}:processing`;

  // 重启恢复：把 processing 里的任务放回 pending
  try {
    let moved = 0;
    while (true) {
      const item = await redis.rpoplpush(processingKey, pendingKey);
      if (!item) break;
      moved++;
    }
    if (moved > 0) {
      console.warn(`[Scheduler] Re-queued ${moved} stuck blacklist sync jobs from processing list`);
    }
  } catch (error) {
    console.error('[Scheduler] Failed to re-queue blacklist sync jobs:', error);
  }

  while (true) {
    try {
      const jobData = await redis.brpoplpush(pendingKey, processingKey, 5);
      if (!jobData) continue;

      const job = safeJsonParse<BlacklistSyncJob | null>(jobData, null);
      if (!job || typeof job.sourceId !== 'number') {
        console.error('[Scheduler] Invalid blacklist sync job:', jobData);
        await redis.lrem(processingKey, 1, jobData);
        continue;
      }

      try {
        await syncBlacklistSourceById(job.sourceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Scheduler] Blacklist source sync failed: sourceId=${job.sourceId} error=${message}`);
        try {
          db.prepare(
            `UPDATE blacklist_sources
             SET sync_status = 'failed',
                 sync_error = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(message, job.sourceId);
        } catch (dbError) {
          console.error('[Scheduler] Failed to update blacklist_sources status:', dbError);
        }
      } finally {
        await redis.lrem(processingKey, 1, jobData);
      }
    } catch (error) {
      console.error('[Scheduler] Blacklist source sync queue error:', error);
      await sleep(1000);
    }
  }
}

/**
 * 过期清理任务
 */
async function runExpiryCleanup(): Promise<void> {
  const taskName: TaskName = 'expiryCleanup';
  taskStatuses[taskName].lastRun = new Date();
  taskStatuses[taskName].runCount++;

  console.log('[Scheduler] Running expiry cleanup...');

  try {
    const results = await cleanupExpiredBlacklists();
    taskStatuses[taskName].lastSuccess = new Date();
    taskStatuses[taskName].lastError = null;
    console.log('[Scheduler] Expiry cleanup completed:', results);
  } catch (error) {
    taskStatuses[taskName].errorCount++;
    taskStatuses[taskName].lastError = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Scheduler] Expiry cleanup failed:', error);
  }
}

/**
 * 统计聚合任务
 */
async function runStatsAggregation(): Promise<void> {
  const taskName: TaskName = 'statsAggregation';
  taskStatuses[taskName].lastRun = new Date();
  taskStatuses[taskName].runCount++;

  console.log('[Scheduler] Running stats aggregation...');

  try {
    const today = new Date().toISOString().split('T')[0];

    // 聚合今日统计
    const stats = db
      .prepare(
        `
        SELECT
          user_id,
          offer_id,
          COUNT(*) as total_visits,
          SUM(CASE WHEN decision = 'money' THEN 1 ELSE 0 END) as money_page_visits,
          SUM(CASE WHEN decision = 'safe' THEN 1 ELSE 0 END) as safe_page_visits,
          COUNT(DISTINCT ip_address) as unique_ips,
          AVG(fraud_score) as avg_fraud_score,
          SUM(CASE WHEN blocked_at_layer = 'L1' THEN 1 ELSE 0 END) as blocked_l1,
          SUM(CASE WHEN blocked_at_layer = 'L2' THEN 1 ELSE 0 END) as blocked_l2,
          SUM(CASE WHEN blocked_at_layer = 'L3' THEN 1 ELSE 0 END) as blocked_l3,
          SUM(CASE WHEN blocked_at_layer = 'L4' THEN 1 ELSE 0 END) as blocked_l4,
          SUM(CASE WHEN blocked_at_layer = 'L5' THEN 1 ELSE 0 END) as blocked_l5,
          SUM(CASE WHEN blocked_at_layer = 'TIMEOUT' THEN 1 ELSE 0 END) as blocked_timeout
        FROM cloak_logs
        WHERE DATE(created_at) = ?
        GROUP BY user_id, offer_id
      `
      )
      .all(today) as Array<{
      user_id: number;
      offer_id: number;
      total_visits: number;
      money_page_visits: number;
      safe_page_visits: number;
      unique_ips: number;
      avg_fraud_score: number;
      blocked_l1: number;
      blocked_l2: number;
      blocked_l3: number;
      blocked_l4: number;
      blocked_l5: number;
      blocked_timeout: number;
    }>;

    // Upsert 统计
    const upsertStmt = db.prepare(`
      INSERT INTO daily_stats (
        user_id, offer_id, stat_date,
        total_visits, money_page_visits, safe_page_visits, unique_ips, avg_fraud_score,
        blocked_l1, blocked_l2, blocked_l3, blocked_l4, blocked_l5, blocked_timeout,
        updated_at
      ) VALUES (
        @user_id, @offer_id, @stat_date,
        @total_visits, @money_page_visits, @safe_page_visits, @unique_ips, @avg_fraud_score,
        @blocked_l1, @blocked_l2, @blocked_l3, @blocked_l4, @blocked_l5, @blocked_timeout,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_id, offer_id, stat_date) DO UPDATE SET
        total_visits = excluded.total_visits,
        money_page_visits = excluded.money_page_visits,
        safe_page_visits = excluded.safe_page_visits,
        unique_ips = excluded.unique_ips,
        avg_fraud_score = excluded.avg_fraud_score,
        blocked_l1 = excluded.blocked_l1,
        blocked_l2 = excluded.blocked_l2,
        blocked_l3 = excluded.blocked_l3,
        blocked_l4 = excluded.blocked_l4,
        blocked_l5 = excluded.blocked_l5,
        blocked_timeout = excluded.blocked_timeout,
        updated_at = CURRENT_TIMESTAMP
    `);

    const upsertMany = db.transaction((rows: typeof stats) => {
      for (const row of rows) {
        upsertStmt.run({
          ...row,
          stat_date: today,
        });
      }
    });

    upsertMany(stats);

    taskStatuses[taskName].lastSuccess = new Date();
    taskStatuses[taskName].lastError = null;
    console.log(`[Scheduler] Stats aggregation completed: ${stats.length} groups`);
  } catch (error) {
    taskStatuses[taskName].errorCount++;
    taskStatuses[taskName].lastError = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Scheduler] Stats aggregation failed:', error);
  }
}

/**
 * 获取调度器状态
 */
function getStatus(): Record<string, unknown> {
  return {
    uptime: process.uptime(),
    tasks: taskStatuses,
    intervals: {
      blacklistSync: BLACKLIST_SYNC_INTERVAL,
      expiryCleanup: EXPIRY_CLEANUP_INTERVAL,
      statsAggregation: STATS_AGGREGATION_INTERVAL,
    },
  };
}

/**
 * 优雅关闭
 */
function gracefulShutdown(): void {
  console.log('[Scheduler] Shutting down...');

  if (db) {
    db.close();
  }

  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

/**
 * 启动调度器
 */
async function start(): Promise<void> {
  await init();

  // 设置定时任务
  setInterval(runBlacklistSync, BLACKLIST_SYNC_INTERVAL);
  setInterval(runExpiryCleanup, EXPIRY_CLEANUP_INTERVAL);
  setInterval(runStatsAggregation, STATS_AGGREGATION_INTERVAL);

  // 手动触发的外部黑名单源同步队列
  startBlacklistSourceSyncQueue().catch((err) => {
    console.error('[Scheduler] Failed to start blacklist source sync queue:', err);
  });

  console.log('[Scheduler] Started with intervals:');
  console.log(`  - Blacklist sync: ${BLACKLIST_SYNC_INTERVAL / 1000}s`);
  console.log(`  - Expiry cleanup: ${EXPIRY_CLEANUP_INTERVAL / 1000}s`);
  console.log(`  - Stats aggregation: ${STATS_AGGREGATION_INTERVAL / 1000}s`);

  // 定期打印状态
  setInterval(() => {
    console.log('[Scheduler] Status:', JSON.stringify(getStatus(), null, 2));
  }, 60000); // 每分钟
}

start().catch((err) => {
  console.error('[Scheduler] Failed to start:', err);
  process.exit(1);
});
