import Database from 'better-sqlite3';
/**
 * 获取数据库实例（单例）
 */
export declare function getDatabase(): Database.Database;
/**
 * 关闭数据库连接
 */
export declare function closeDatabase(): void;
/**
 * 执行查询并返回所有结果
 */
export declare function queryAll<T>(sql: string, params?: unknown[]): T[];
/**
 * 执行查询并返回单个结果
 */
export declare function queryOne<T>(sql: string, params?: unknown[]): T | undefined;
/**
 * 执行插入/更新/删除操作
 */
export declare function execute(sql: string, params?: unknown[]): Database.RunResult;
/**
 * 批量插入（事务）
 */
export declare function batchInsert<T extends Record<string, unknown>>(tableName: string, records: T[]): void;
/**
 * 执行事务
 */
export declare function transaction<T>(fn: () => T): T;
export { Database };
//# sourceMappingURL=connection.d.ts.map