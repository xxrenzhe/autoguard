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
 * 处理队列 - 使用 brpop 阻塞等待，比 rpop+sleep 更高效
 */
async function processQueue(): Promise<void> {
  console.log('Log Writer started, waiting for logs...');

  // brpop 超时时间（秒），0 表示无限等待，这里设置为合理的超时
  const BRPOP_TIMEOUT = Math.ceil(FLUSH_INTERVAL_MS / 1000) || 1;

  while (true) {
    try {
      const logs: CloakLogEntry[] = [];

      // 使用 brpop 阻塞等待第一条日志
      const firstResult = await redis.brpop(CacheKeys.queue.cloakLogs, BRPOP_TIMEOUT);

      if (firstResult) {
        // brpop 返回 [key, value]
        try {
          const log = JSON.parse(firstResult[1]) as CloakLogEntry;
          logs.push(log);
        } catch (parseError) {
          console.error('Failed to parse log entry:', parseError);
        }

        // 有数据后，继续用 rpop 批量获取剩余的（非阻塞）
        for (let i = 1; i < BATCH_SIZE; i++) {
          const result = await redis.rpop(CacheKeys.queue.cloakLogs);
          if (!result) break;

          try {
            const log = JSON.parse(result) as CloakLogEntry;
            logs.push(log);
          } catch (parseError) {
            console.error('Failed to parse log entry:', parseError);
          }
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
      // brpop 已经处理了等待，无需额外 sleep
    } catch (error) {
      console.error('Log write error:', error);
      await sleep(1000);
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
