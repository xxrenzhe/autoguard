import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryAll, queryOne, execute, invalidatePromptCache } from '@autoguard/shared';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/prompts/:id - 获取 Prompt 详情（含所有版本）
 */
export async function GET(request: NextRequest, context: RouteParams) {
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

    const prompt = queryOne<{
      id: number;
      name: string;
      description: string | null;
      category: string;
      active_version_id: number | null;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM prompts WHERE id = ?', [promptId]);

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // 获取所有版本
    const versions = queryAll<{
      id: number;
      version: number;
      content: string;
      variables: string | null;
      usage_count: number;
      success_rate: number | null;
      is_active: number;
      created_at: string;
      activated_at: string | null;
      created_by: number | null;
    }>(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC',
      [promptId]
    );

    return NextResponse.json({
      data: {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        category: prompt.category,
        activeVersionId: prompt.active_version_id,
        isActive: prompt.is_active === 1,
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at,
        versions: versions.map((v) => ({
          id: v.id,
          version: `v${v.version}`,
          content: v.content,
          variables: v.variables ? JSON.parse(v.variables) : null,
          usageCount: v.usage_count,
          successRate: v.success_rate,
          status: v.is_active ? 'active' : 'deprecated',
          createdAt: v.created_at,
          activatedAt: v.activated_at,
          createdBy: v.created_by,
        })),
      },
    });
  } catch (error) {
    console.error('Failed to get prompt:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/prompts/:id - 激活指定版本（SystemDesign2 兼容）
 * Body: { versionId: number }
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
    const { versionId } = body as { versionId?: number };

    if (!versionId) {
      return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
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
    execute('UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = ?', [promptId]);

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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to activate version:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/prompts/:id - 更新 Prompt 基本信息
 */
export async function PATCH(request: NextRequest, context: RouteParams) {
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
    const { description, isActive } = body;

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }

    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(promptId);

    execute(
      `UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update prompt:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/prompts/:id - 删除 Prompt
 */
export async function DELETE(request: NextRequest, context: RouteParams) {
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

    // 删除 prompt（级联删除版本）
    execute('DELETE FROM prompts WHERE id = ?', [promptId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete prompt:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
