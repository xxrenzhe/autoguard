import { queryAll, queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type BlacklistCounts = {
  ip: number;
  ip_ranges: number;
  uas: number;
  isps: number;
  geos: number;
};

type TopHit = { type: string; value: string; hits: number };

function getCounts(whereSql: string, params: unknown[]): BlacklistCounts {
  return {
    ip:
      queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM blacklist_ips WHERE is_active = 1 ${whereSql}`,
        params
      )?.count || 0,
    ip_ranges:
      queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM blacklist_ip_ranges WHERE is_active = 1 ${whereSql}`,
        params
      )?.count || 0,
    uas:
      queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM blacklist_uas WHERE is_active = 1 ${whereSql}`,
        params
      )?.count || 0,
    isps:
      queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM blacklist_isps WHERE is_active = 1 ${whereSql}`,
        params
      )?.count || 0,
    geos:
      queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM blacklist_geos WHERE is_active = 1 ${whereSql}`,
        params
      )?.count || 0,
  };
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function getTopHits(userId: number): TopHit[] {
  const rows = queryAll<{
    detection_details: string | null;
    ip_address: string;
    user_agent: string | null;
    ip_asn: string | null;
    ip_isp: string | null;
    ip_country: string | null;
  }>(
    `SELECT detection_details, ip_address, user_agent, ip_asn, ip_isp, ip_country
     FROM cloak_logs
     WHERE user_id = ?
       AND blocked_at_layer = 'L1'
       AND created_at >= DATETIME('now', '-7 day')
     ORDER BY created_at DESC
     LIMIT 2000`,
    [userId]
  );

  const counts = new Map<string, TopHit>();

  for (const row of rows) {
    const details = safeParseJson(row.detection_details) as
      | {
          l1?: {
            blockedType?: string;
            blockedValue?: string;
            ipBlocked?: boolean;
            uaBlocked?: boolean;
            ispBlocked?: boolean;
            geoBlocked?: boolean;
          };
        }
      | null;

    const l1 = details?.l1;

    let type: string | null = null;
    let value: string | null = null;

    if (l1?.blockedType && l1?.blockedValue) {
      type = l1.blockedType;
      value = l1.blockedValue;
    } else if (l1?.ipBlocked) {
      type = 'ip';
      value = row.ip_address;
    } else if (l1?.uaBlocked) {
      type = 'ua';
      value = row.user_agent?.slice(0, 200) || 'unknown';
    } else if (l1?.ispBlocked) {
      type = 'isp';
      value = row.ip_asn || row.ip_isp || 'unknown';
    } else if (l1?.geoBlocked) {
      type = 'geo';
      value = row.ip_country || 'unknown';
    }

    if (!type || !value) continue;

    const key = `${type}::${value}`;
    const existing = counts.get(key);
    if (existing) {
      existing.hits += 1;
    } else {
      counts.set(key, { type, value, hits: 1 });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10);
}

// GET /api/blacklist/stats - Blacklist statistics (SystemDesign2)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const global = getCounts('AND user_id IS NULL', []);
  const userScoped = getCounts('AND user_id = ?', [user.userId]);

  const hitsToday =
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM cloak_logs
       WHERE user_id = ?
         AND blocked_at_layer = 'L1'
         AND DATE(created_at) = DATE('now')`,
      [user.userId]
    )?.count || 0;

  const hitsWeek =
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM cloak_logs
       WHERE user_id = ?
         AND blocked_at_layer = 'L1'
         AND created_at >= DATETIME('now', '-7 day')`,
      [user.userId]
    )?.count || 0;

  const topHits = getTopHits(user.userId);

  return success({
    counts: {
      ip: global.ip,
      ip_ranges: global.ip_ranges,
      isps: global.isps,
      uas: global.uas,
      geos: global.geos,
    },
    hits_today: hitsToday,
    hits_week: hitsWeek,
    top_hits: topHits,
    user_counts: {
      ip: userScoped.ip,
      ip_ranges: userScoped.ip_ranges,
      isps: userScoped.isps,
      uas: userScoped.uas,
      geos: userScoped.geos,
    },
  });
}
