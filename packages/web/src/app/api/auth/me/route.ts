import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@autoguard/shared';
import type { User } from '@autoguard/shared';
import { success, errors } from '@/lib/api-response';

export async function GET() {
  const payload = await getCurrentUser();

  if (!payload) {
    return errors.unauthorized();
  }

  const user = queryOne<User>('SELECT * FROM users WHERE id = ?', [payload.userId]);

  if (!user) {
    return errors.notFound('User not found');
  }

  const { password_hash, ...userWithoutPassword } = user;
  void password_hash;

  return success({ user: userWithoutPassword });
}
