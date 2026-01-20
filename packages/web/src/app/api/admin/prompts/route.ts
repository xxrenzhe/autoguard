import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryAll, queryOne, execute } from '@autoguard/shared';

/**
 * GET /api/admin/prompts - 获取所有 Prompt 列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const prompts = queryAll<{
      id: number;
      name: string;
      description: string | null;
      category: string;
      active_version_id: number | null;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM prompts ORDER BY category, name');

    // 获取每个 prompt 的活跃版本信息
    const data = prompts.map((prompt) => {
      let activeVersion = null;

      if (prompt.active_version_id) {
        const version = queryOne<{
          id: number;
          version: number;
          usage_count: number;
          success_rate: number | null;
        }>(
          'SELECT id, version, usage_count, success_rate FROM prompt_versions WHERE id = ?',
          [prompt.active_version_id]
        );

        if (version) {
          activeVersion = {
            id: version.id,
            version: `v${version.version}`,
            usageCount: version.usage_count,
            successRate: version.success_rate,
          };
        }
      }

      return {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        category: prompt.category,
        isActive: prompt.is_active === 1,
        activeVersion,
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to get prompts:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/prompts - 创建新 Prompt
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, category, content } = body;

    if (!name || !category || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: name, category, content' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = queryOne<{ id: number }>(
      'SELECT id FROM prompts WHERE name = ?',
      [name]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Prompt with this name already exists' },
        { status: 409 }
      );
    }

    // 创建 prompt
    execute(
      `INSERT INTO prompts (name, description, category, is_active)
       VALUES (?, ?, ?, 1)`,
      [name, description || null, category]
    );

    const newPrompt = queryOne<{ id: number }>(
      'SELECT id FROM prompts WHERE name = ?',
      [name]
    );

    if (!newPrompt) {
      throw new Error('Failed to create prompt');
    }

    // 创建初始版本
    execute(
      `INSERT INTO prompt_versions (prompt_id, version, content, is_active, created_by)
       VALUES (?, 1, ?, 1, ?)`,
      [newPrompt.id, content, session.userId]
    );

    const version = queryOne<{ id: number }>(
      'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = 1',
      [newPrompt.id]
    );

    // 更新 active_version_id
    if (version) {
      execute('UPDATE prompts SET active_version_id = ? WHERE id = ?', [
        version.id,
        newPrompt.id,
      ]);
    }

    return NextResponse.json({
      data: {
        id: newPrompt.id,
        name,
        description,
        category,
        activeVersionId: version?.id,
      },
    });
  } catch (error) {
    console.error('Failed to create prompt:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
