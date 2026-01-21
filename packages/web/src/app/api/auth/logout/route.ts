import { clearAuthCookie } from '@/lib/auth';
import { success } from '@/lib/api-response';

export async function POST() {
  await clearAuthCookie();
  return success({ ok: true }, 'Logged out');
}
