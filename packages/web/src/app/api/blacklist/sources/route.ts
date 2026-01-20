import { queryAll, queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { list, errors } from '@/lib/api-response';

interface BlacklistSource {
  id: number;
  name: string;
  source_type: string;
  url: string | null;
  description: string | null;
  is_active: number;
  last_sync_at: string | null;
  sync_status: string | null;
  entry_count: number;
  created_at: string;
  updated_at: string;
}

// GET /api/blacklist/sources - Get blacklist data sources
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  // Only admin can view sources
  if (user.role !== 'admin') {
    return errors.forbidden('Only administrators can view blacklist sources');
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = (page - 1) * limit;

  const sources = queryAll<BlacklistSource>(
    `SELECT * FROM blacklist_sources ORDER BY name ASC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  const countResult = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM blacklist_sources'
  );
  const total = countResult?.count || 0;

  return list(sources, { page, limit, total });
}
