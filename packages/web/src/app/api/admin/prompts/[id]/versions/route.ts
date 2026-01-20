import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryAll, queryOne, execute } from '@autoguard/shared';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/prompts/:id/versions - 获取版本列表
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

    // 检查 prompt 是否存在
    const prompt = queryOne<{ id: number; active_version_id: number | null }>(
      'SELECT id, active_version_id FROM prompts WHERE id = ?',
      [promptId]
    );

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    const versions = queryAll<{
      id: number;
      prompt_id: number;
      version: number;
      content: string;
      is_active: number;
      created_at: string;
      activated_at: string | null;
    }>(
      `SELECT id, prompt_id, version, content, is_active, created_at, activated_at
       FROM prompt_versions
       WHERE prompt_id = ?
       ORDER BY version DESC`,
      [promptId]
    );

    return NextResponse.json({
      data: versions.map((v) => ({
        id: v.id,
        prompt_id: v.prompt_id,
        version: v.version,
        content: v.content,
        is_active: v.is_active,
        status: v.is_active ? 'active' : 'draft',
        created_at: v.created_at,
        activated_at: v.activated_at,
      })),
    });
  } catch (error) {
    console.error('Failed to get versions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/prompts/:id/versions - 创建新版本
 */
export async function POST(request: NextRequest, context: RouteParams) {
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
    const { content, variables } = body;

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    // 检查 prompt 是否存在
    const prompt = queryOne<{ id: number }>(
      'SELECT id FROM prompts WHERE id = ?',
      [promptId]
    );

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // 获取当前最大版本号
    const maxVersion = queryOne<{ max_version: number }>(
      'SELECT MAX(version) as max_version FROM prompt_versions WHERE prompt_id = ?',
      [promptId]
    );

    const newVersionNumber = (maxVersion?.max_version || 0) + 1;

    // 创建新版本
    execute(
      `INSERT INTO prompt_versions (prompt_id, version, content, variables, is_active, created_by)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [
        promptId,
        newVersionNumber,
        content,
        variables ? JSON.stringify(variables) : null,
        session.userId,
      ]
    );

    const newVersion = queryOne<{ id: number }>(
      'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
      [promptId, newVersionNumber]
    );

    return NextResponse.json({
      data: {
        id: newVersion?.id,
        version: `v${newVersionNumber}`,
        status: 'draft',
      },
    });
  } catch (error) {
    console.error('Failed to create version:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
