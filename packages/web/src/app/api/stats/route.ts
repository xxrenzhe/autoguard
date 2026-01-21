import { z } from 'zod';
import { queryAll, queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

interface DailyStat {
  date: string;
  total_visits: number;
  money_page_visits: number;
  safe_page_visits: number;
  unique_ips: number;
}

interface OverallStat {
  total_visits: number;
  money_page_visits: number;
  safe_page_visits: number;
  unique_ips: number;
  cloak_rate: number;
}

const queryParamsSchema = z.object({
  offer_id: z.coerce.number().int().positive().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

// GET /api/stats - 获取统计数据
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const { searchParams } = new URL(request.url);
    const params = queryParamsSchema.parse({
      offer_id: searchParams.get('offer_id'),
      start_date: searchParams.get('start_date'),
      end_date: searchParams.get('end_date'),
      period: searchParams.get('period') || '30d',
    });

    // 计算日期范围
    let startDate: string;
    let endDate: string;

    if (params.start_date && params.end_date) {
      startDate = params.start_date;
      endDate = params.end_date;
    } else {
      const now = new Date();
      endDate = now.toISOString().split('T')[0]!;

      const daysMap: Record<string, number> = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
        'all': 365 * 10, // 10 years
      };
      const days = daysMap[params.period] ?? 7;
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      startDate = start.toISOString().split('T')[0]!;
    }

    // 构建查询条件
    let whereClause = 'WHERE ds.stat_date BETWEEN ? AND ?';
    const whereParams: unknown[] = [startDate, endDate];

    if (params.offer_id) {
      // 验证 offer 属于当前用户
      const offer = queryOne<{ id: number }>(
        'SELECT id FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
        [params.offer_id, user.userId]
      );

      if (!offer) {
        return errors.notFound('Offer not found');
      }

      whereClause += ' AND ds.offer_id = ?';
      whereParams.push(params.offer_id);
    } else {
      // 只查询当前用户的 offers
      whereClause += ' AND ds.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)';
      whereParams.push(user.userId);
    }

    // 获取每日统计
    const dailyStats = queryAll<DailyStat>(
      `SELECT
        ds.stat_date as date,
        SUM(ds.total_visits) as total_visits,
        SUM(ds.money_page_visits) as money_page_visits,
        SUM(ds.safe_page_visits) as safe_page_visits,
        SUM(ds.unique_ips) as unique_ips
      FROM daily_stats ds
      ${whereClause}
      GROUP BY ds.stat_date
      ORDER BY ds.stat_date ASC`,
      whereParams
    );

    // 计算总体统计
    const overallResult = queryOne<{
      total_visits: number;
      money_page_visits: number;
      safe_page_visits: number;
      unique_ips: number;
    }>(
      `SELECT
        COALESCE(SUM(ds.total_visits), 0) as total_visits,
        COALESCE(SUM(ds.money_page_visits), 0) as money_page_visits,
        COALESCE(SUM(ds.safe_page_visits), 0) as safe_page_visits,
        COALESCE(SUM(ds.unique_ips), 0) as unique_ips
      FROM daily_stats ds
      ${whereClause}`,
      whereParams
    );

    const overall: OverallStat = {
      total_visits: overallResult?.total_visits || 0,
      money_page_visits: overallResult?.money_page_visits || 0,
      safe_page_visits: overallResult?.safe_page_visits || 0,
      unique_ips: overallResult?.unique_ips || 0,
      cloak_rate: overallResult && overallResult.total_visits > 0
        ? Math.round((overallResult.safe_page_visits / overallResult.total_visits) * 10000) / 100
        : 0,
    };

    // 获取今日实时统计（从 cloak_logs）
    const today = new Date().toISOString().split('T')[0]!;
    let todayWhereClause = "WHERE DATE(cl.created_at) = ?";
    const todayParams: unknown[] = [today];

    if (params.offer_id) {
      todayWhereClause += ' AND cl.offer_id = ?';
      todayParams.push(params.offer_id);
    } else {
      todayWhereClause += ' AND cl.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)';
      todayParams.push(user.userId);
    }

    const todayResult = queryOne<{
      total: number;
      money: number;
      safe: number;
    }>(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN cl.decision = 'money' THEN 1 ELSE 0 END) as money,
        SUM(CASE WHEN cl.decision = 'safe' THEN 1 ELSE 0 END) as safe
      FROM cloak_logs cl
      ${todayWhereClause}`,
      todayParams
    );

    const todayStats = {
      total_visits: todayResult?.total || 0,
      money_page_visits: todayResult?.money || 0,
      safe_page_visits: todayResult?.safe || 0,
    };

    // 获取 Top 国家
    const topCountries = queryAll<{ country: string; visits: number }>(
      `SELECT
        cl.ip_country as country,
        COUNT(*) as visits
      FROM cloak_logs cl
      ${todayWhereClause.replace('DATE(cl.created_at) = ?', 'cl.created_at >= ?')}
      AND cl.ip_country IS NOT NULL
      GROUP BY cl.ip_country
      ORDER BY visits DESC
      LIMIT 10`,
      [startDate, ...todayParams.slice(1)]
    );

    // 获取按 Offer 分组的统计
    const byOffer = queryAll<{
      offer_id: number;
      brand_name: string;
      total_visits: number;
      money_page_visits: number;
      safe_page_visits: number;
    }>(
      `SELECT
        o.id as offer_id,
        o.brand_name,
        COALESCE(SUM(ds.total_visits), 0) as total_visits,
        COALESCE(SUM(ds.money_page_visits), 0) as money_page_visits,
        COALESCE(SUM(ds.safe_page_visits), 0) as safe_page_visits
      FROM offers o
      LEFT JOIN daily_stats ds ON ds.offer_id = o.id AND ds.stat_date BETWEEN ? AND ?
      WHERE o.user_id = ? AND o.is_deleted = 0
      GROUP BY o.id
      ORDER BY total_visits DESC`,
      [startDate, endDate, user.userId]
    );

    return success({
      overall,
      today: todayStats,
      daily: dailyStats,
      byOffer,
      topCountries,
      period: {
        start: startDate,
        end: endDate,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid parameters', { errors: error.errors });
    }

    console.error('Fetch stats error:', error);
    return errors.internal();
  }
}
