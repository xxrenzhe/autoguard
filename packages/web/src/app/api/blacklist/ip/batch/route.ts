import { z } from 'zod';
import { execute, syncIPBlacklist } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const batchSchema = z.object({
  action: z.enum(['delete', 'disable', 'enable']),
  ids: z.array(z.coerce.number().int().positive()).min(1).max(1000),
});

// POST /api/blacklist/ip/batch - Batch operations for IP entries (SystemDesign2)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action, ids } = batchSchema.parse(body);
    const uniqueIds = Array.from(new Set(ids));

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const isAdmin = user.role === 'admin';

    const whereUserSql = isAdmin
      ? '(user_id = ? OR user_id IS NULL)'
      : 'user_id = ?';

    const isActive = action === 'enable' ? 1 : 0;

    const result = execute(
      `UPDATE blacklist_ips
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders}) AND ${whereUserSql}`,
      [isActive, ...uniqueIds, user.userId]
    );

    try {
      await syncIPBlacklist();
    } catch (err) {
      console.error('Failed to sync IP blacklist after batch:', err);
    }

    return success(
      { affected: result.changes, action },
      `Batch action applied: ${action}`
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('IP batch error:', error);
    return errors.internal('Failed to process batch operation');
  }
}

