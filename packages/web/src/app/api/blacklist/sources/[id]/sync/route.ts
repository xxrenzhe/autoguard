import { queryOne, execute, getRedis, CacheKeys, deleteCache } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

interface BlacklistSource {
  id: number;
  name: string;
  source_type: string;
  url: string | null;
  is_active: number;
}

// POST /api/blacklist/sources/[id]/sync - Manually sync a blacklist source
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  // Only admin can sync sources
  if (user.role !== 'admin') {
    return errors.forbidden('Only administrators can sync blacklist sources');
  }

  const { id } = await params;
  const sourceId = parseInt(id, 10);

  const source = queryOne<BlacklistSource>(
    'SELECT * FROM blacklist_sources WHERE id = ?',
    [sourceId]
  );

  if (!source) {
    return errors.notFound('Blacklist source not found');
  }

  if (!source.is_active) {
    return errors.validation('Source is not active');
  }

  if (!source.url) {
    return errors.validation('Source URL is empty');
  }

  try {
    // Update sync status to 'syncing'
    execute(
      `UPDATE blacklist_sources SET sync_status = 'syncing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sourceId]
    );

    // Queue sync job
    const redis = getRedis();
    const job = {
      sourceId,
      sourceName: source.name,
      sourceType: source.source_type,
      url: source.url,
      triggeredBy: user.userId,
      triggeredAt: new Date().toISOString(),
    };

    await redis.lpush('autoguard:queue:blacklist_sync', JSON.stringify(job));

    // Invalidate related caches
    try {
      await deleteCache(
        CacheKeys.blacklist.ip('global'),
        CacheKeys.blacklist.ipRanges('global'),
        CacheKeys.blacklist.isps('global'),
        CacheKeys.blacklist.uas('global'),
        CacheKeys.blacklist.geos('global')
      );
    } catch {
      // Cache invalidation is non-blocking
    }

    return success(
      {
        id: sourceId,
        name: source.name,
        sync_status: 'syncing',
        queued_at: new Date().toISOString(),
      },
      'Sync job queued successfully'
    );
  } catch (error) {
    console.error('Sync source error:', error);

    // Update sync status to error
    execute(
      `UPDATE blacklist_sources SET sync_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sourceId]
    );

    return errors.internal('Failed to queue sync job');
  }
}
