/**
 * Admin User Detail API
 * 单个用户管理接口
 */

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne, execute, hashPassword } from '@autoguard/shared';
import type { User, UserWithoutPassword } from '@autoguard/shared';
import { z } from 'zod';
import { success, errors } from '@/lib/api-response';
import { withSnakeCaseAliases } from '@/lib/key-case';

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
      return errors.forbidden('需要管理员权限');
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return errors.validation('无效的用户ID');
    }

    const user = queryOne<UserWithoutPassword>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return errors.notFound('用户不存在');
    }

    return success(user);
  } catch (error) {
    console.error('Get user error:', error);
    return errors.internal('获取用户信息失败');
  }
}

/**
 * PATCH /api/admin/users/[id] - 更新用户
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return errors.forbidden('需要管理员权限');
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return errors.validation('无效的用户ID');
    }

    // 检查用户是否存在
    const existingUser = queryOne<User>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return errors.notFound('用户不存在');
    }

    const body = withSnakeCaseAliases(await request.json());
    const parsed = UpdateUserSchema.safeParse(body);

    if (!parsed.success) {
      return errors.validation('输入验证失败', { errors: parsed.error.errors });
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
        return errors.validation('不能降级自己的权限');
      }
      updates.push('role = ?');
      values.push(role);
    }

    if (status !== undefined) {
      // 防止管理员封禁自己
      if (userId === session.userId && status === 'suspended') {
        return errors.validation('不能封禁自己');
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
    const updatedUser = queryOne<UserWithoutPassword>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    return success(updatedUser);
  } catch (error) {
    console.error('Update user error:', error);
    return errors.internal('更新用户失败');
  }
}

/**
 * DELETE /api/admin/users/[id] - 删除用户
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return errors.forbidden('需要管理员权限');
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return errors.validation('无效的用户ID');
    }

    // 防止删除自己
    if (userId === session.userId) {
      return errors.validation('不能删除自己');
    }

    // 检查用户是否存在
    const existingUser = queryOne<User>('SELECT id FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return errors.notFound('用户不存在');
    }

    // 删除用户（级联删除关联数据）
    execute('DELETE FROM users WHERE id = ?', [userId]);

    return success({ deleted: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return errors.internal('删除用户失败');
  }
}
