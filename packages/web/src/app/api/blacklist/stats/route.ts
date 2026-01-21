import { queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type BlacklistCounts = {
  ip: number;
  ip_ranges: number;
  uas: number;
  isps: number;
  geos: number;
};

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
    top_hits: [],
    user_counts: {
      ip: userScoped.ip,
      ip_ranges: userScoped.ip_ranges,
      isps: userScoped.isps,
      uas: userScoped.uas,
      geos: userScoped.geos,
    },
  });
}
