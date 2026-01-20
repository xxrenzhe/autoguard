import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

/**
 * 获取数据库实例（单例）
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  // Support both SQLITE_DB_PATH and DATABASE_PATH (docker-compose uses DATABASE_PATH)
  const dbPath = process.env.SQLITE_DB_PATH || process.env.DATABASE_PATH || './data/db/autoguard.db';

  // 确保目录存在
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // 初始化配置
  initDatabaseConfig(db);

  return db;
}

/**
 * 初始化数据库配置（WAL 模式等）
 */
function initDatabaseConfig(database: Database.Database): void {
  // 启用 WAL 模式（提高并发性能）
  database.pragma('journal_mode = WAL');

  // 设置繁忙超时 5 秒
  database.pragma('busy_timeout = 5000');

  // WAL 模式下 NORMAL 同步足够安全
  database.pragma('synchronous = NORMAL');

  // 增加缓存到 64MB
  database.pragma('cache_size = -65536');

  // 启用外键约束
  database.pragma('foreign_keys = ON');

  // 内存映射 I/O（256MB）
  database.pragma('mmap_size = 268435456');
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * 执行查询并返回所有结果
 */
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as T[];
}

/**
 * 执行查询并返回单个结果
 */
export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  return stmt.get(...params) as T | undefined;
}

/**
 * 执行插入/更新/删除操作
 */
export function execute(sql: string, params: unknown[] = []): Database.RunResult {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  return stmt.run(...params);
}

/**
 * 批量插入（事务）
 */
export function batchInsert<T extends Record<string, unknown>>(
  tableName: string,
  records: T[]
): void {
  if (records.length === 0) return;

  const database = getDatabase();
  const columns = Object.keys(records[0]!);
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

  const stmt = database.prepare(sql);
  const insertMany = database.transaction((items: T[]) => {
    for (const item of items) {
      stmt.run(...columns.map((col) => item[col]));
    }
  });

  insertMany(records);
}

/**
 * 执行事务
 */
export function transaction<T>(fn: () => T): T {
  const database = getDatabase();
  return database.transaction(fn)();
}

export { Database };
