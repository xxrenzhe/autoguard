/**
 * Log Writer
 * 独立进程，负责从 Redis 队列批量写入 Cloak 日志到 SQLite
 */

import Database from 'better-sqlite3';
import { Redis } from 'ioredis';
import { CacheKeys } from '@autoguard/shared';

// 配置
const BATCH_SIZE = parseInt(process.env.LOG_WRITER_BATCH_SIZE || '100', 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.LOG_WRITER_FLUSH_INTERVAL || '1000', 10);
const DB_PATH = process.env.SQLITE_DB_PATH || './data/db/autoguard.db';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// 初始化
const redis = new Redis(REDIS_URL);
const db = new Database(DB_PATH);

// 初始化数据库配置
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -65536');

console.log('Log Writer initialized');
console.log(`- Batch size: ${BATCH_SIZE}`);
console.log(`- Flush interval: ${FLUSH_INTERVAL_MS}ms`);
console.log(`- Database: ${DB_PATH}`);

// 日志类型
interface CloakLogEntry {
  user_id: number;
  offer_id: number;
  ip_address: string;
  user_agent: string;
  referer: string | null;
  request_url: string;
  decision: 'money' | 'safe';
  decision_reason: string | null;
  fraud_score: number;
  blocked_at_layer: string | null;
  detection_details: string | null;
  ip_country: string | null;
  ip_city: string | null;
  ip_isp: string | null;
  ip_asn: string | null;
  is_datacenter: number;
  is_vpn: number;
  is_proxy: number;
  processing_time_ms: number;
  has_tracking_params: number;
  gclid: string | null;
  created_at: string;
}

// 预编译 SQL 语句
const insertStmt = db.prepare(`
  INSERT INTO cloak_logs (
    user_id, offer_id, ip_address, user_agent, referer,
    request_url, decision, decision_reason, fraud_score,
    blocked_at_layer, detection_details, ip_country, ip_city,
    ip_isp, ip_asn, is_datacenter, is_vpn, is_proxy,
    processing_time_ms, has_tracking_params, gclid, created_at
  ) VALUES (
    @user_id, @offer_id, @ip_address, @user_agent, @referer,
    @request_url, @decision, @decision_reason, @fraud_score,
    @blocked_at_layer, @detection_details, @ip_country, @ip_city,
    @ip_isp, @ip_asn, @is_datacenter, @is_vpn, @is_proxy,
    @processing_time_ms, @has_tracking_params, @gclid, @created_at
  )
`);

// 批量插入事务
const insertMany = db.transaction((logs: CloakLogEntry[]) => {
  for (const log of logs) {
    insertStmt.run(log);
  }
});

// 统计变量
let totalWritten = 0;
let lastReportTime = Date.now();

/**
 * 处理队列
 */
async function processQueue(): Promise<void> {
  console.log('Log Writer started, waiting for logs...');

  while (true) {
    try {
      const logs: CloakLogEntry[] = [];

      // 批量获取日志
      for (let i = 0; i < BATCH_SIZE; i++) {
        const result = await redis.rpop(CacheKeys.queue.cloakLogs);
        if (!result) break;

        try {
          const log = JSON.parse(result) as CloakLogEntry;
          logs.push(log);
        } catch (parseError) {
          console.error('Failed to parse log entry:', parseError);
        }
      }

      // 批量写入数据库
      if (logs.length > 0) {
        insertMany(logs);
        totalWritten += logs.length;

        // 每 10 秒报告一次统计
        const now = Date.now();
        if (now - lastReportTime > 10000) {
          console.log(`[Stats] Written ${totalWritten} logs total, last batch: ${logs.length}`);
          lastReportTime = now;
        }
      }

      // 如果队列为空，等待一会儿
      if (logs.length < BATCH_SIZE) {
        await sleep(FLUSH_INTERVAL_MS);
      }
    } catch (error) {
      console.error('Log write error:', error);
      await sleep(1000);
    }
  }
}

/**
 * 更新每日统计
 */
async function updateDailyStats(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  try {
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

    // 更新或插入统计
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
    console.log(`[Stats] Updated daily stats for ${today}, ${stats.length} groups`);
  } catch (error) {
    console.error('Failed to update daily stats:', error);
  }
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 优雅关闭
 */
function gracefulShutdown(): void {
  console.log('Shutting down Log Writer...');
  redis.quit();
  db.close();
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 启动
processQueue();

// 每 5 分钟更新一次统计
setInterval(updateDailyStats, 5 * 60 * 1000);
