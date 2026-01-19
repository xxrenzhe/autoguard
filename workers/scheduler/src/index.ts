/**
 * Scheduler Worker
 * 定时任务调度器，负责周期性任务
 * - 黑名单同步 (DB -> Redis)
 * - 黑名单过期清理
 * - 每日统计聚合
 * - 外部黑名单源同步
 */

import {
  syncAllBlacklists,
  cleanupExpiredBlacklists,
  getRedis,
  CacheKeys,
} from '@autoguard/shared';
import Database from 'better-sqlite3';

// 配置
const BLACKLIST_SYNC_INTERVAL = parseInt(process.env.BLACKLIST_SYNC_INTERVAL || '300000', 10); // 5 分钟
const EXPIRY_CLEANUP_INTERVAL = parseInt(process.env.EXPIRY_CLEANUP_INTERVAL || '3600000', 10); // 1 小时
const STATS_AGGREGATION_INTERVAL = parseInt(process.env.STATS_AGGREGATION_INTERVAL || '300000', 10); // 5 分钟
const DB_PATH = process.env.SQLITE_DB_PATH || './data/db/autoguard.db';

// 任务状态
interface TaskStatus {
  lastRun: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
}

const taskStatuses: Record<string, TaskStatus> = {
  blacklistSync: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
  expiryCleanup: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
  statsAggregation: { lastRun: null, lastSuccess: null, lastError: null, runCount: 0, errorCount: 0 },
};

// 数据库连接
let db: Database.Database;

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

/**
 * 黑名单同步任务
 */
async function runBlacklistSync(): Promise<void> {
  const taskName = 'blacklistSync';
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

/**
 * 过期清理任务
 */
async function runExpiryCleanup(): Promise<void> {
  const taskName = 'expiryCleanup';
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
  const taskName = 'statsAggregation';
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
          SUM(CASE WHEN decision = 'money' THEN 1 ELSE 0 END) as money_visits,
          SUM(CASE WHEN decision = 'safe' THEN 1 ELSE 0 END) as safe_visits,
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
      money_visits: number;
      safe_visits: number;
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
        total_visits, money_visits, safe_visits, unique_ips, avg_fraud_score,
        blocked_l1, blocked_l2, blocked_l3, blocked_l4, blocked_l5, blocked_timeout,
        updated_at
      ) VALUES (
        @user_id, @offer_id, @stat_date,
        @total_visits, @money_visits, @safe_visits, @unique_ips, @avg_fraud_score,
        @blocked_l1, @blocked_l2, @blocked_l3, @blocked_l4, @blocked_l5, @blocked_timeout,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_id, offer_id, stat_date) DO UPDATE SET
        total_visits = excluded.total_visits,
        money_visits = excluded.money_visits,
        safe_visits = excluded.safe_visits,
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
