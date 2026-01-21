import { z } from 'zod';
import { queryAll, queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const queryParamsSchema = z.object({
  offer_id: z.coerce.number().int().positive().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

// GET /api/cloak/stats - Get cloak statistics
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

    // Calculate date range
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
        'all': 365 * 10,
      };
      const days = daysMap[params.period] ?? 7;
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      startDate = start.toISOString().split('T')[0]!;
    }

    // Build query conditions
    let whereClause = 'WHERE ds.stat_date BETWEEN ? AND ?';
    const whereParams: unknown[] = [startDate, endDate];

    if (params.offer_id) {
      // Verify offer belongs to user
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
      whereClause += ' AND ds.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)';
      whereParams.push(user.userId);
    }

    // Get overall stats
    const overallResult = queryOne<{
      total_visits: number;
      money_page_visits: number;
      safe_page_visits: number;
    }>(
      `SELECT
        COALESCE(SUM(ds.total_visits), 0) as total_visits,
        COALESCE(SUM(ds.money_page_visits), 0) as money_page_visits,
        COALESCE(SUM(ds.safe_page_visits), 0) as safe_page_visits
      FROM daily_stats ds
      ${whereClause}`,
      whereParams
    );

    const total = overallResult?.total_visits || 0;
    const money = overallResult?.money_page_visits || 0;
    const safe = overallResult?.safe_page_visits || 0;

    // Calculate cloak metrics
    const cloakRate = total > 0 ? Math.round((safe / total) * 10000) / 100 : 0;
    const moneyRate = total > 0 ? Math.round((money / total) * 10000) / 100 : 0;

    // Get decision breakdown from logs
    const decisionBreakdown = queryAll<{
      decision_reason: string;
      count: number;
    }>(
      `SELECT
        cl.decision_reason,
        COUNT(*) as count
      FROM cloak_logs cl
      WHERE cl.created_at >= ? AND cl.created_at <= ?
        AND cl.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)
      GROUP BY cl.decision_reason
      ORDER BY count DESC
      LIMIT 20`,
      [startDate, endDate + ' 23:59:59', user.userId]
    );

    // Get detection layer stats
    const layerStats = queryOne<{
      l1_blocks: number;
      l2_blocks: number;
      l3_blocks: number;
      l4_blocks: number;
      l5_blocks: number;
    }>(
      `SELECT
        SUM(CASE WHEN cl.decision_reason LIKE '%L1%' OR cl.decision_reason LIKE '%blacklist%' THEN 1 ELSE 0 END) as l1_blocks,
        SUM(CASE WHEN cl.decision_reason LIKE '%L2%' OR cl.decision_reason LIKE '%datacenter%' OR cl.decision_reason LIKE '%vpn%' THEN 1 ELSE 0 END) as l2_blocks,
        SUM(CASE WHEN cl.decision_reason LIKE '%L3%' OR cl.decision_reason LIKE '%geo%' OR cl.decision_reason LIKE '%country%' THEN 1 ELSE 0 END) as l3_blocks,
        SUM(CASE WHEN cl.decision_reason LIKE '%L4%' OR cl.decision_reason LIKE '%ua%' OR cl.decision_reason LIKE '%bot%' THEN 1 ELSE 0 END) as l4_blocks,
        SUM(CASE WHEN cl.decision_reason LIKE '%L5%' OR cl.decision_reason LIKE '%referer%' THEN 1 ELSE 0 END) as l5_blocks
      FROM cloak_logs cl
      WHERE cl.decision = 'safe'
        AND cl.created_at >= ? AND cl.created_at <= ?
        AND cl.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)`,
      [startDate, endDate + ' 23:59:59', user.userId]
    );

    // Get hourly distribution for today
    const today = new Date().toISOString().split('T')[0]!;
    const hourlyDistribution = queryAll<{
      hour: number;
      total: number;
      money: number;
      safe: number;
    }>(
      `SELECT
        CAST(strftime('%H', cl.created_at) AS INTEGER) as hour,
        COUNT(*) as total,
        SUM(CASE WHEN cl.decision = 'money' THEN 1 ELSE 0 END) as money,
        SUM(CASE WHEN cl.decision = 'safe' THEN 1 ELSE 0 END) as safe
      FROM cloak_logs cl
      WHERE DATE(cl.created_at) = ?
        AND cl.offer_id IN (SELECT id FROM offers WHERE user_id = ? AND is_deleted = 0)
      GROUP BY hour
      ORDER BY hour`,
      [today, user.userId]
    );

    return success({
      summary: {
        total_visits: total,
        money_page_visits: money,
        safe_page_visits: safe,
        cloak_rate: cloakRate,
        money_rate: moneyRate,
      },
      detection_layers: {
        l1_blacklist: layerStats?.l1_blocks || 0,
        l2_ip_intel: layerStats?.l2_blocks || 0,
        l3_geo: layerStats?.l3_blocks || 0,
        l4_ua: layerStats?.l4_blocks || 0,
        l5_referer: layerStats?.l5_blocks || 0,
      },
      decision_breakdown: decisionBreakdown,
      hourly_today: hourlyDistribution,
      period: {
        start: startDate,
        end: endDate,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid parameters', { errors: error.errors });
    }

    console.error('Fetch cloak stats error:', error);
    return errors.internal();
  }
}
