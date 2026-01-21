/**
 * Admin Page Generation DLQ Requeue API
 * 将单条 page_generation:dead 任务重新放回队列（可选择重置 attempt）
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getRedis, CacheKeys } from '@autoguard/shared';
import { success, errors } from '@/lib/api-response';
import { withSnakeCaseAliases } from '@/lib/key-case';

const bodySchema = z.object({
  jobData: z.string().min(1),
  resetAttempt: z.boolean().optional().default(true),
});

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const REQUEUE_JOB_LUA = `
local deadKey = KEYS[1]
local queueKey = KEYS[2]
local deadJob = ARGV[1]
local newJob = ARGV[2]

local removed = redis.call('LREM', deadKey, 1, deadJob)
if removed == 1 then
  redis.call('LPUSH', queueKey, newJob)
end
return removed
`;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return errors.forbidden('需要管理员权限');
  }

  let payload: unknown;
  try {
    payload = withSnakeCaseAliases(await request.json());
  } catch {
    return errors.validation('Invalid JSON body');
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return errors.validation('Invalid input', { errors: parsed.error.errors });
  }

  const { jobData, resetAttempt } = parsed.data;
  const queueKey = CacheKeys.queue.pageGeneration;
  const deadKey = `${queueKey}:dead`;

  let requeueData = jobData;
  if (resetAttempt) {
    const parsedJob = safeJson(jobData);
    if (parsedJob && typeof parsedJob === 'object') {
      const job = { ...(parsedJob as Record<string, unknown>) };
      job.attempt = 0;
      delete job.failedAt;
      delete job.error;
      requeueData = JSON.stringify(job);
    }
  }

  const redis = getRedis();
  try {
    const removed = await redis.eval(REQUEUE_JOB_LUA, 2, deadKey, queueKey, jobData, requeueData);
    const moved = Number(removed) === 1;
    if (!moved) {
      return errors.notFound('Job not found in DLQ');
    }
    return success({ moved: true });
  } catch (error) {
    console.error('Admin requeue job error:', error);
    return errors.internal('重放任务失败');
  }
}

