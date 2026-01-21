import { syncAllBlacklists, cleanupExpiredBlacklists } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

// POST /api/blacklist/sync - Trigger blacklist sync
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  // Only admins can trigger sync
  if (user.role !== 'admin') {
    return errors.forbidden('Admin access required');
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'sync';

    let result: Record<string, unknown>;

    switch (action) {
      case 'sync':
        result = await syncAllBlacklists();
        return success(result, 'Blacklist sync completed');

      case 'cleanup':
        result = await cleanupExpiredBlacklists();
        return success(result, 'Expired entries cleanup completed');

      case 'full':
        // First cleanup, then sync
        {
          const cleanupResult = await cleanupExpiredBlacklists();
          const syncResult = await syncAllBlacklists();
          return success(
            {
              cleanup: cleanupResult,
              sync: syncResult,
            },
            'Full maintenance completed'
          );
        }

      default:
        return errors.validation('Invalid action. Use: sync, cleanup, or full', { action });
    }
  } catch (error) {
    console.error('Blacklist sync error:', error);
    return errors.internal('Failed to sync blacklist');
  }
}

// GET /api/blacklist/sync - Get sync status
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  return success({
    description: 'Blacklist sync API',
    endpoints: {
      'POST ?action=sync': 'Sync all blacklists from DB to Redis',
      'POST ?action=cleanup': 'Clean up expired blacklist entries',
      'POST ?action=full': 'Run cleanup and then sync',
    },
    note: 'Admin access required for all operations',
  });
}
