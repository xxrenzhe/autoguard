/**
 * Admin Queues API
 * 提供队列状态（用于排障/监控面板）
 */

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getRedis, CacheKeys } from '@autoguard/shared';
import { success, errors } from '@/lib/api-response';

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return errors.forbidden('需要管理员权限');
  }

  const redis = getRedis();

  const pageGeneration = CacheKeys.queue.pageGeneration;
  const cloakLogs = CacheKeys.queue.cloakLogs;
  const blacklistSync = 'autoguard:queue:blacklist_sync';

  try {
    const [
      pagePending,
      pageProcessing,
      pageDelayed,
      pageDead,
      cloakPending,
      cloakProcessing,
      blacklistPending,
      blacklistProcessing,
    ] = await Promise.all([
      redis.llen(pageGeneration),
      redis.llen(`${pageGeneration}:processing`),
      redis.zcard(`${pageGeneration}:delayed`),
      redis.llen(`${pageGeneration}:dead`),
      redis.llen(cloakLogs),
      redis.llen(`${cloakLogs}:processing`),
      redis.llen(blacklistSync),
      redis.llen(`${blacklistSync}:processing`),
    ]);

    return success({
      now: new Date().toISOString(),
      queues: {
        pageGeneration: {
          pending: pagePending,
          processing: pageProcessing,
          delayed: pageDelayed,
          dead: pageDead,
        },
        cloakLogs: { pending: cloakPending, processing: cloakProcessing },
        blacklistSync: { pending: blacklistPending, processing: blacklistProcessing },
      },
    });
  } catch (error) {
    console.error('Admin queues status error:', error);
    return errors.internal('获取队列状态失败');
  }
}

