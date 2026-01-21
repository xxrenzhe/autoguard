import { z } from 'zod';
import { queryAll } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const searchSchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

interface ISPEntry {
  id: number;
  asn: string | null;
  isp_name: string | null;
  reason: string | null;
  source: string | null;
  is_active: number;
  created_at: string;
}

// GET /api/blacklist/isps/search - Search ISP blacklist entries
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const { searchParams } = new URL(request.url);
    const params = searchSchema.parse({
      query: searchParams.get('query') || '',
      limit: searchParams.get('limit') || 50,
    });

    let sql = `SELECT * FROM blacklist_isps WHERE is_active = 1`;
    const sqlParams: unknown[] = [];

    if (params.query) {
      sql += ` AND (asn LIKE ? OR isp_name LIKE ?)`;
      const searchTerm = `%${params.query}%`;
      sqlParams.push(searchTerm, searchTerm);
    }

    sql += ` ORDER BY isp_name ASC, asn ASC LIMIT ?`;
    sqlParams.push(params.limit);

    const entries = queryAll<ISPEntry>(sql, sqlParams);

    return success(
      entries.map((entry) => ({
        id: entry.id,
        asn: entry.asn,
        isp_name: entry.isp_name,
        reason: entry.reason,
        source: entry.source,
        label: entry.isp_name || entry.asn || 'Unknown',
      }))
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid parameters', { errors: error.errors });
    }

    console.error('ISP search error:', error);
    return errors.internal();
  }
}
