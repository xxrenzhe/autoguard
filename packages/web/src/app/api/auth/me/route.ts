import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@autoguard/shared';
import type { User } from '@autoguard/shared';

export async function GET() {
  const payload = await getCurrentUser();

  if (!payload) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const user = queryOne<User>('SELECT * FROM users WHERE id = ?', [payload.userId]);

  if (!user) {
    return NextResponse.json(
      { error: { code: 'USER_NOT_FOUND', message: 'User not found' } },
      { status: 404 }
    );
  }

  const { password_hash, ...userWithoutPassword } = user;

  return NextResponse.json({
    success: true,
    data: { user: userWithoutPassword },
  });
}
