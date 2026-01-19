/**
 * Blacklist Sync Service
 * 同步黑名单数据从 SQLite 到 Redis
 * 支持全量同步和增量同步
 */

import { getRedis, CacheKeys } from './cache/index.js';
import { queryAll } from './db/index.js';
import type {
  BlacklistIP,
  BlacklistIPRange,
  BlacklistUA,
  BlacklistISP,
  BlacklistGeo,
} from './types/index.js';

// 同步配置
const SYNC_BATCH_SIZE = 1000;

/**
 * 同步所有黑名单数据到 Redis
 */
export async function syncAllBlacklists(): Promise<{
  ips: number;
  ipRanges: number;
  uas: number;
  isps: number;
  geos: number;
}> {
  console.log('[BlacklistSync] Starting full sync...');

  const results = {
    ips: await syncIPBlacklist(),
    ipRanges: await syncIPRangeBlacklist(),
    uas: await syncUABlacklist(),
    isps: await syncISPBlacklist(),
    geos: await syncGeoBlacklist(),
  };

  console.log('[BlacklistSync] Full sync completed:', results);
  return results;
}

/**
 * 同步 IP 黑名单
 */
export async function syncIPBlacklist(): Promise<number> {
  const redis = getRedis();
  let synced = 0;

  // 获取所有活跃的 IP 黑名单
  const entries = queryAll<BlacklistIP>(
    `SELECT * FROM blacklist_ips WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    []
  );

  // 按 user_id 分组
  const globalIPs: string[] = [];
  const userIPsMap = new Map<number, string[]>();

  for (const entry of entries) {
    if (entry.user_id === null) {
      globalIPs.push(entry.ip_address);
    } else {
      const existing = userIPsMap.get(entry.user_id) || [];
      existing.push(entry.ip_address);
      userIPsMap.set(entry.user_id, existing);
    }
    synced++;
  }

  // 写入全局 IP 黑名单
  const globalKey = CacheKeys.blacklist.ip('global');
  await redis.del(globalKey);
  if (globalIPs.length > 0) {
    await redis.sadd(globalKey, ...globalIPs);
  }

  // 写入用户 IP 黑名单
  for (const [userId, ips] of userIPsMap) {
    const userKey = CacheKeys.blacklist.ip(userId);
    await redis.del(userKey);
    if (ips.length > 0) {
      await redis.sadd(userKey, ...ips);
    }
  }

  console.log(`[BlacklistSync] Synced ${synced} IP entries`);
  return synced;
}

/**
 * 同步 IP 范围（CIDR）黑名单
 */
export async function syncIPRangeBlacklist(): Promise<number> {
  const redis = getRedis();
  let synced = 0;

  // 获取所有活跃的 CIDR 黑名单
  const entries = queryAll<BlacklistIPRange>(
    `SELECT * FROM blacklist_ip_ranges WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    []
  );

  // 按 user_id 分组
  const globalCIDRs: string[] = [];
  const userCIDRsMap = new Map<number, string[]>();

  for (const entry of entries) {
    if (entry.user_id === null) {
      globalCIDRs.push(entry.cidr);
    } else {
      const existing = userCIDRsMap.get(entry.user_id) || [];
      existing.push(entry.cidr);
      userCIDRsMap.set(entry.user_id, existing);
    }
    synced++;
  }

  // 写入全局 CIDR 黑名单（存储为 JSON 数组）
  const globalKey = CacheKeys.blacklist.ipRanges('global');
  await redis.set(globalKey, JSON.stringify(globalCIDRs));

  // 写入用户 CIDR 黑名单
  for (const [userId, cidrs] of userCIDRsMap) {
    const userKey = CacheKeys.blacklist.ipRanges(userId);
    await redis.set(userKey, JSON.stringify(cidrs));
  }

  console.log(`[BlacklistSync] Synced ${synced} IP range (CIDR) entries`);
  return synced;
}

/**
 * 同步 UA 黑名单
 */
export async function syncUABlacklist(): Promise<number> {
  const redis = getRedis();
  let synced = 0;

  // 获取所有活跃的 UA 黑名单
  const entries = queryAll<BlacklistUA>(
    `SELECT * FROM blacklist_uas WHERE is_active = 1`,
    []
  );

  // 按 user_id 分组
  const globalUAs: string[] = [];
  const userUAsMap = new Map<number, string[]>();

  for (const entry of entries) {
    // 将 UA 模式存储为 JSON（包含模式和类型）
    const uaEntry = JSON.stringify({
      pattern: entry.pattern,
      type: entry.pattern_type,
    });

    if (entry.user_id === null) {
      globalUAs.push(uaEntry);
    } else {
      const existing = userUAsMap.get(entry.user_id) || [];
      existing.push(uaEntry);
      userUAsMap.set(entry.user_id, existing);
    }
    synced++;
  }

  // 写入全局 UA 黑名单（LIST 存储）
  const globalKey = CacheKeys.blacklist.uas('global');
  await redis.del(globalKey);
  if (globalUAs.length > 0) {
    await redis.rpush(globalKey, ...globalUAs);
  }

  // 写入用户 UA 黑名单
  for (const [userId, uas] of userUAsMap) {
    const userKey = CacheKeys.blacklist.uas(userId);
    await redis.del(userKey);
    if (uas.length > 0) {
      await redis.rpush(userKey, ...uas);
    }
  }

  console.log(`[BlacklistSync] Synced ${synced} UA entries`);
  return synced;
}

/**
 * 同步 ISP/ASN 黑名单
 */
export async function syncISPBlacklist(): Promise<number> {
  const redis = getRedis();
  let synced = 0;

  // 获取所有活跃的 ISP 黑名单
  const entries = queryAll<BlacklistISP>(
    `SELECT * FROM blacklist_isps WHERE is_active = 1`,
    []
  );

  // 按 user_id 分组
  const globalASNs: string[] = [];
  const globalNames: Record<string, string> = {};
  const userASNsMap = new Map<number, string[]>();
  const userNamesMap = new Map<number, Record<string, string>>();

  for (const entry of entries) {
    if (entry.user_id === null) {
      if (entry.asn) {
        globalASNs.push(entry.asn);
        if (entry.isp_name) {
          globalNames[entry.asn] = entry.isp_name;
        }
      }
    } else {
      if (entry.asn) {
        const existing = userASNsMap.get(entry.user_id) || [];
        existing.push(entry.asn);
        userASNsMap.set(entry.user_id, existing);

        if (entry.isp_name) {
          const names = userNamesMap.get(entry.user_id) || {};
          names[entry.asn] = entry.isp_name;
          userNamesMap.set(entry.user_id, names);
        }
      }
    }
    synced++;
  }

  // 写入全局 ISP 黑名单（SET 存储 ASN）
  const globalKey = CacheKeys.blacklist.isps('global');
  await redis.del(globalKey);
  if (globalASNs.length > 0) {
    await redis.sadd(globalKey, ...globalASNs);
  }

  // 写入全局 ISP 名称映射（HASH）
  await redis.del(`${globalKey}:names`);
  if (Object.keys(globalNames).length > 0) {
    await redis.hset(`${globalKey}:names`, globalNames);
  }

  // 写入用户 ISP 黑名单
  for (const [userId, asns] of userASNsMap) {
    const userKey = CacheKeys.blacklist.isps(userId);
    await redis.del(userKey);
    if (asns.length > 0) {
      await redis.sadd(userKey, ...asns);
    }

    const names = userNamesMap.get(userId);
    if (names && Object.keys(names).length > 0) {
      await redis.del(`${userKey}:names`);
      await redis.hset(`${userKey}:names`, names);
    }
  }

  console.log(`[BlacklistSync] Synced ${synced} ISP/ASN entries`);
  return synced;
}

/**
 * 同步 Geo 黑名单
 */
export async function syncGeoBlacklist(): Promise<number> {
  const redis = getRedis();
  let synced = 0;

  // 获取所有活跃的 Geo 黑名单
  const entries = queryAll<BlacklistGeo>(
    `SELECT * FROM blacklist_geos WHERE is_active = 1`,
    []
  );

  // 按 user_id 分组
  const globalGeos: Record<string, string> = {};
  const userGeosMap = new Map<number, Record<string, string>>();

  for (const entry of entries) {
    // Key: country_code 或 country_code:region_code
    const key = entry.region_code
      ? `${entry.country_code}:${entry.region_code}`
      : entry.country_code;

    if (entry.user_id === null) {
      globalGeos[key] = entry.block_type;
    } else {
      const existing = userGeosMap.get(entry.user_id) || {};
      existing[key] = entry.block_type;
      userGeosMap.set(entry.user_id, existing);
    }
    synced++;
  }

  // 写入全局 Geo 黑名单（HASH 存储）
  const globalKey = CacheKeys.blacklist.geos('global');
  await redis.del(globalKey);
  if (Object.keys(globalGeos).length > 0) {
    await redis.hset(globalKey, globalGeos);
  }

  // 写入用户 Geo 黑名单
  for (const [userId, geos] of userGeosMap) {
    const userKey = CacheKeys.blacklist.geos(userId);
    await redis.del(userKey);
    if (Object.keys(geos).length > 0) {
      await redis.hset(userKey, geos);
    }
  }

  console.log(`[BlacklistSync] Synced ${synced} Geo entries`);
  return synced;
}

/**
 * 清理过期的黑名单条目
 */
export async function cleanupExpiredBlacklists(): Promise<{
  ips: number;
  ipRanges: number;
}> {
  let cleanedIPs = 0;
  let cleanedRanges = 0;

  // 获取已过期的条目数量
  const expiredIPs = queryAll<{ id: number }>(
    `SELECT id FROM blacklist_ips WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')`,
    []
  );

  const expiredRanges = queryAll<{ id: number }>(
    `SELECT id FROM blacklist_ip_ranges WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')`,
    []
  );

  // 标记为非活跃（软删除）
  if (expiredIPs.length > 0) {
    const { execute } = await import('./db/index.js');
    for (const entry of expiredIPs) {
      execute(
        `UPDATE blacklist_ips SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [entry.id]
      );
      cleanedIPs++;
    }
  }

  if (expiredRanges.length > 0) {
    const { execute } = await import('./db/index.js');
    for (const entry of expiredRanges) {
      execute(
        `UPDATE blacklist_ip_ranges SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [entry.id]
      );
      cleanedRanges++;
    }
  }

  console.log(
    `[BlacklistSync] Cleaned up ${cleanedIPs} expired IPs and ${cleanedRanges} expired IP ranges`
  );

  // 重新同步 Redis
  if (cleanedIPs > 0) {
    await syncIPBlacklist();
  }
  if (cleanedRanges > 0) {
    await syncIPRangeBlacklist();
  }

  return { ips: cleanedIPs, ipRanges: cleanedRanges };
}

/**
 * 添加单个 IP 到黑名单并同步到 Redis
 */
export async function addIPToBlacklist(
  ip: string,
  userId: number | null,
  reason?: string,
  source?: string,
  expiresAt?: string
): Promise<void> {
  const redis = getRedis();

  // 添加到 Redis
  const key =
    userId === null
      ? CacheKeys.blacklist.ip('global')
      : CacheKeys.blacklist.ip(userId);

  await redis.sadd(key, ip);

  // 同时写入数据库（确保持久化）
  const { execute } = await import('./db/index.js');
  execute(
    `INSERT INTO blacklist_ips (user_id, ip_address, reason, source, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET is_active = 1, reason = ?, source = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP`,
    [userId, ip, reason || null, source || 'api', expiresAt || null, reason || null, source || 'api', expiresAt || null]
  );
}

/**
 * 从黑名单移除单个 IP 并同步到 Redis
 */
export async function removeIPFromBlacklist(
  ip: string,
  userId: number | null
): Promise<void> {
  const redis = getRedis();

  // 从 Redis 移除
  const key =
    userId === null
      ? CacheKeys.blacklist.ip('global')
      : CacheKeys.blacklist.ip(userId);

  await redis.srem(key, ip);

  // 同时更新数据库
  const { execute } = await import('./db/index.js');
  execute(
    `UPDATE blacklist_ips SET is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE ip_address = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NULL))`,
    [ip, userId, userId]
  );
}
