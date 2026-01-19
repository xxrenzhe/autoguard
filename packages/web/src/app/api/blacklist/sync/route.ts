import { NextResponse } from 'next/server';
import { syncAllBlacklists, cleanupExpiredBlacklists } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

// POST /api/blacklist/sync - Trigger blacklist sync
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  // Only admins can trigger sync
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'sync';

    let result: Record<string, unknown>;

    switch (action) {
      case 'sync':
        result = await syncAllBlacklists();
        return NextResponse.json({
          success: true,
          message: 'Blacklist sync completed',
          data: result,
        });

      case 'cleanup':
        result = await cleanupExpiredBlacklists();
        return NextResponse.json({
          success: true,
          message: 'Expired entries cleanup completed',
          data: result,
        });

      case 'full':
        // First cleanup, then sync
        const cleanupResult = await cleanupExpiredBlacklists();
        const syncResult = await syncAllBlacklists();
        return NextResponse.json({
          success: true,
          message: 'Full maintenance completed',
          data: {
            cleanup: cleanupResult,
            sync: syncResult,
          },
        });

      default:
        return NextResponse.json(
          { error: { code: 'INVALID_ACTION', message: 'Invalid action. Use: sync, cleanup, or full' } },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Blacklist sync error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to sync blacklist' } },
      { status: 500 }
    );
  }
}

// GET /api/blacklist/sync - Get sync status
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      description: 'Blacklist sync API',
      endpoints: {
        'POST ?action=sync': 'Sync all blacklists from DB to Redis',
        'POST ?action=cleanup': 'Clean up expired blacklist entries',
        'POST ?action=full': 'Run cleanup and then sync',
      },
      note: 'Admin access required for all operations',
    },
  });
}
