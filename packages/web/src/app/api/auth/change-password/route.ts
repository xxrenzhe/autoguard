import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { queryOne, execute } from '@autoguard/shared';
import type { User } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

// POST /api/auth/change-password - Change user password
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const data = changePasswordSchema.parse(body);

    // Get user with password hash
    const dbUser = queryOne<User>(
      'SELECT * FROM users WHERE id = ? AND status = ?',
      [user.userId, 'active']
    );

    if (!dbUser) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }

    // Verify current password
    const isValid = await bcrypt.compare(data.current_password, dbUser.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } },
        { status: 400 }
      );
    }

    // Prevent reusing the same password
    const isSamePassword = await bcrypt.compare(data.new_password, dbUser.password_hash);
    if (isSamePassword) {
      return NextResponse.json(
        { error: { code: 'SAME_PASSWORD', message: 'New password must be different from current password' } },
        { status: 400 }
      );
    }

    // Hash new password
    const newHash = await bcrypt.hash(data.new_password, 10);

    // Update password in database
    execute(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHash, user.userId]
    );

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Change password error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
