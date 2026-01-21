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

  return success({
    global,
    user: userScoped,
  });
}

