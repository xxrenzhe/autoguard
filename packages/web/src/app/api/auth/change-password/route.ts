import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { queryOne, execute } from '@autoguard/shared';
import type { User } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

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
    return errors.unauthorized();
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
      return errors.notFound('User not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(data.current_password, dbUser.password_hash);
    if (!isValid) {
      return errors.validation('Current password is incorrect');
    }

    // Prevent reusing the same password
    const isSamePassword = await bcrypt.compare(data.new_password, dbUser.password_hash);
    if (isSamePassword) {
      return errors.validation('New password must be different from current password');
    }

    // Hash new password
    const newHash = await bcrypt.hash(data.new_password, 10);

    // Update password in database
    execute(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHash, user.userId]
    );

    return success({ ok: true }, 'Password changed successfully');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Change password error:', error);
    return errors.internal();
  }
}
