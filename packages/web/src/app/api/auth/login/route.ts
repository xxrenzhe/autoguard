import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { queryOne, execute } from '@autoguard/shared';
import type { User } from '@autoguard/shared';
import { createToken, setAuthCookie } from '@/lib/auth';
import { withRateLimit, defaultRateLimits, rateLimitExceededResponse } from '@/lib/rate-limit';
import { success, errors } from '@/lib/api-response';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  // Apply rate limiting for login attempts (stricter limit)
  const rateLimitResult = await withRateLimit(
    request,
    null,
    'auth:login',
    defaultRateLimits.auth
  );

  if (!rateLimitResult.allowed) {
    return rateLimitExceededResponse(rateLimitResult);
  }

  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // 查询用户
    const user = queryOne<User>(
      'SELECT * FROM users WHERE email = ? AND status = ?',
      [email, 'active']
    );

    if (!user) {
      return errors.unauthorized('Invalid email or password');
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return errors.unauthorized('Invalid email or password');
    }

    // 更新最后登录时间
    execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [
      user.id,
    ]);

    // 创建 JWT Token
    const { password_hash, ...userWithoutPassword } = user;
    void password_hash;
    const token = await createToken(userWithoutPassword);

    // 设置 Cookie
    await setAuthCookie(token);

    return success({ user: userWithoutPassword });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Login error:', error);
    return errors.internal();
  }
}
