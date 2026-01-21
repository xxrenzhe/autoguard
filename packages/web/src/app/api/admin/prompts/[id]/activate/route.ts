import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, execute, invalidatePromptCache } from '@autoguard/shared';
import { success, errors } from '@/lib/api-response';

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
      return errors.forbidden('需要管理员权限');
    }

    const { id } = await context.params;
    const promptId = parseInt(id, 10);

    if (isNaN(promptId)) {
      return errors.validation('Invalid prompt ID');
    }

    const body = await request.json();
    const { versionId } = body;

    if (!versionId) {
      return errors.validation('versionId is required');
    }

    // 检查版本是否存在且属于该 prompt
    const version = queryOne<{ id: number; prompt_id: number }>(
      'SELECT id, prompt_id FROM prompt_versions WHERE id = ?',
      [versionId]
    );

    if (!version || version.prompt_id !== promptId) {
      return errors.notFound('Version not found or does not belong to this prompt');
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
      await invalidatePromptCache(prompt.name);
    }

    return success({ ok: true });
  } catch (error) {
    console.error('Failed to activate version:', error);
    return errors.internal('Internal server error');
  }
}
