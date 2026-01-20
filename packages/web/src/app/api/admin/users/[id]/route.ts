/**
 * Admin User Detail API
 * 单个用户管理接口
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, execute, hashPassword } from '@autoguard/shared';
import type { User } from '@autoguard/shared';
import { z } from 'zod';

// 更新用户请求验证
const UpdateUserSchema = z.object({
  display_name: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  password: z.string().min(8).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/users/[id] - 获取用户详情
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '需要管理员权限' } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ID', message: '无效的用户ID' } },
        { status: 400 }
      );
    }

    const user = queryOne<User>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取用户信息失败' } },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users/[id] - 更新用户
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '需要管理员权限' } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ID', message: '无效的用户ID' } },
        { status: 400 }
      );
    }

    // 检查用户是否存在
    const existingUser = queryOne<User>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = UpdateUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '输入验证失败',
            details: parsed.error.errors,
          },
        },
        { status: 400 }
      );
    }

    const { display_name, role, status, password } = parsed.data;

    // 构建更新字段
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: (string | number)[] = [];

    if (display_name !== undefined) {
      updates.push('display_name = ?');
      values.push(display_name);
    }

    if (role !== undefined) {
      // 防止管理员降级自己
      if (userId === session.userId && role !== 'admin') {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: '不能降级自己的权限' } },
          { status: 400 }
        );
      }
      updates.push('role = ?');
      values.push(role);
    }

    if (status !== undefined) {
      // 防止管理员封禁自己
      if (userId === session.userId && status === 'suspended') {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: '不能封禁自己' } },
          { status: 400 }
        );
      }
      updates.push('status = ?');
      values.push(status);
    }

    if (password) {
      const password_hash = await hashPassword(password);
      updates.push('password_hash = ?');
      values.push(password_hash);
    }

    // 执行更新
    values.push(userId);
    execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    // 获取更新后的用户
    const updatedUser = queryOne<User>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '更新用户失败' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[id] - 删除用户
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '需要管理员权限' } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ID', message: '无效的用户ID' } },
        { status: 400 }
      );
    }

    // 防止删除自己
    if (userId === session.userId) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: '不能删除自己' } },
        { status: 400 }
      );
    }

    // 检查用户是否存在
    const existingUser = queryOne<User>('SELECT id FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } },
        { status: 404 }
      );
    }

    // 删除用户（级联删除关联数据）
    execute('DELETE FROM users WHERE id = ?', [userId]);

    return NextResponse.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '删除用户失败' } },
      { status: 500 }
    );
  }
}
