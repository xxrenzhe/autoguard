/**
 * Admin Page Generation DLQ API
 * 用于查看 page_generation:dead 中的失败任务（只读）
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getRedis, CacheKeys } from '@autoguard/shared';
import { success, errors } from '@/lib/api-response';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(20),
});

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return errors.forbidden('需要管理员权限');
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ limit: searchParams.get('limit') || undefined });
  if (!parsed.success) {
    return errors.validation('Invalid parameters', { errors: parsed.error.errors });
  }

  const { limit } = parsed.data;
  const redis = getRedis();

  const queueKey = CacheKeys.queue.pageGeneration;
  const deadKey = `${queueKey}:dead`;

  try {
    const [total, rawItems] = await Promise.all([
      redis.llen(deadKey),
      redis.lrange(deadKey, 0, limit - 1),
    ]);

    const items = rawItems.map((raw, index) => {
      const parsedValue = safeJson(raw);
      const job = parsedValue && typeof parsedValue === 'object' ? (parsedValue as Record<string, unknown>) : {};

      const pageId = typeof job.pageId === 'number' ? job.pageId : null;
      const offerId = typeof job.offerId === 'number' ? job.offerId : null;
      const variant = typeof job.variant === 'string' ? job.variant : null;
      const action = typeof job.action === 'string' ? job.action : null;
      const attempt = typeof job.attempt === 'number' ? job.attempt : null;
      const failedAt = typeof job.failedAt === 'string' ? job.failedAt : null;
      const error = typeof job.error === 'string' ? job.error : null;

      return {
        index,
        raw,
        pageId,
        offerId,
        variant,
        action,
        attempt,
        failedAt,
        error,
      };
    });

    return success({
      total,
      limit,
      items,
    });
  } catch (error) {
    console.error('Admin page generation dead jobs error:', error);
    return errors.internal('获取 DLQ 失败任务失败');
  }
}

