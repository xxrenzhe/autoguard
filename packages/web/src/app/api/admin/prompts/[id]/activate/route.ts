import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/admin/prompts/:id/activate - 激活指定版本
 */
export async function PUT(request: NextRequest, context: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const promptId = parseInt(id, 10);

    if (isNaN(promptId)) {
      return NextResponse.json({ error: 'Invalid prompt ID' }, { status: 400 });
    }

    const body = await request.json();
    const { versionId } = body;

    if (!versionId) {
      return NextResponse.json(
        { error: 'versionId is required' },
        { status: 400 }
      );
    }

    // 检查版本是否存在且属于该 prompt
    const version = queryOne<{ id: number; prompt_id: number }>(
      'SELECT id, prompt_id FROM prompt_versions WHERE id = ?',
      [versionId]
    );

    if (!version || version.prompt_id !== promptId) {
      return NextResponse.json(
        { error: 'Version not found or does not belong to this prompt' },
        { status: 404 }
      );
    }

    // 获取 prompt 名称用于清除缓存
    const prompt = queryOne<{ name: string }>(
      'SELECT name FROM prompts WHERE id = ?',
      [promptId]
    );

    // 停用所有版本
    execute(
      'UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = ?',
      [promptId]
    );

    // 激活指定版本
    execute(
      'UPDATE prompt_versions SET is_active = 1, activated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [versionId]
    );

    // 更新 prompt 的 active_version_id
    execute(
      'UPDATE prompts SET active_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [versionId, promptId]
    );

    // 清除缓存
    if (prompt) {
      try {
        const redis = getRedis();
        await redis.del(`autoguard:prompt:${prompt.name}`);
      } catch (cacheError) {
        console.warn('Failed to clear prompt cache:', cacheError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to activate version:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
