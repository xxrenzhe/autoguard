import { z } from 'zod';
import { execute, queryOne } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  is_active: z.union([z.boolean(), z.coerce.number().int().min(0).max(1)]),
});

interface BlacklistSource {
  id: number;
  is_active: number;
}

// PATCH /api/blacklist/sources/[id] - Toggle source status (SystemDesign2)
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  if (user.role !== 'admin') {
    return errors.forbidden('Only administrators can update blacklist sources');
  }

  const { id } = await params;
  const sourceId = parseInt(id, 10);
  if (!Number.isFinite(sourceId)) {
    return errors.validation('Invalid source id', { id });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = updateSchema.parse(body);
    const isActive = parsed.is_active ? 1 : 0;

    const existing = queryOne<BlacklistSource>(
      `SELECT id, is_active FROM blacklist_sources WHERE id = ?`,
      [sourceId]
    );
    if (!existing) {
      return errors.notFound('Blacklist source not found');
    }

    execute(
      `UPDATE blacklist_sources SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [isActive, sourceId]
    );

    return success({ id: sourceId, is_active: isActive === 1 }, 'Source updated');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Update source error:', error);
    return errors.internal('Failed to update source');
  }
}
