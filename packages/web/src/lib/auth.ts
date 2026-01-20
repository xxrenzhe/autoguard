/**
 * JWT 认证工具
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { UserWithoutPassword } from '@autoguard/shared';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);
const JWT_EXPIRES_IN = '7d';
const COOKIE_NAME = 'autoguard-token';

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
}

/**
 * 创建 JWT Token
 */
export async function createToken(user: UserWithoutPassword): Promise<string> {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);

  return token;
}

/**
 * 验证 JWT Token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 设置认证 Cookie
 */
export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 天
    path: '/',
  });
}

/**
 * 获取认证 Cookie
 */
export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

/**
 * 清除认证 Cookie
 */
export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * 获取当前用户
 */
export async function getCurrentUser(): Promise<JWTPayload | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  return verifyToken(token);
}

/**
 * 获取会话 (别名，方便 API 使用)
 */
export async function getSession(): Promise<JWTPayload | null> {
  return getCurrentUser();
}
