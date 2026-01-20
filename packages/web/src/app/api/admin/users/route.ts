/**
 * Admin Users API
 * 管理员用户管理接口
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query, queryOne, execute, hashPassword } from '@autoguard/shared';
import type { User, UserWithoutPassword } from '@autoguard/shared';
import { z } from 'zod';

// 创建用户请求验证
const CreateUserSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少8位'),
  display_name: z.string().optional(),
  role: z.enum(['admin', 'user']).default('user'),
});

// 更新用户请求验证
const UpdateUserSchema = z.object({
  display_name: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  password: z.string().min(8).optional(),
});

/**
 * GET /api/admin/users - 获取用户列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '需要管理员权限' } },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const offset = (page - 1) * limit;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (email LIKE ? OR display_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // 获取总数
    const countResult = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM users ${whereClause}`,
      params
    );
    const total = countResult?.count || 0;

    // 获取用户列表（不包含密码）
    const users = query<User>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // 移除密码哈希
    const safeUsers: UserWithoutPassword[] = users.map(({ password_hash, ...user }) => user);

    return NextResponse.json({
      success: true,
      data: safeUsers,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取用户列表失败' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users - 创建用户
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '需要管理员权限' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = CreateUserSchema.safeParse(body);

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

    const { email, password, display_name, role } = parsed.data;

    // 检查邮箱是否已存在
    const existingUser = queryOne<{ id: number }>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: { code: 'EMAIL_EXISTS', message: '该邮箱已被注册' } },
        { status: 400 }
      );
    }

    // 创建用户
    const password_hash = await hashPassword(password);
    const result = execute(
      `INSERT INTO users (email, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [email, password_hash, display_name || null, role]
    );

    const userId = result.lastInsertRowid;

    // 获取创建的用户
    const newUser = queryOne<User>(
      `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: newUser,
    });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '创建用户失败' } },
      { status: 500 }
    );
  }
}
