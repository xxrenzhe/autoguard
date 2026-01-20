import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, execute } from '@autoguard/shared';

interface RouteParams {
  params: Promise<{ id: string }>;
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
