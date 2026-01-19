import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'autoguard-secret-key-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

export interface JWTPayload {
  userId: number;
  email: string;
  role: 'admin' | 'user';
  iat?: number;
  exp?: number;
}

/**
 * 生成 JWT Token
 */
export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);

  const token = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);

  return token;
}

/**
 * 验证 JWT Token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);

    return payload as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 验证 JWT Token (Edge Runtime 兼容)
 */
export async function verifyTokenEdge(token: string): Promise<JWTPayload | null> {
  return verifyToken(token);
}

/**
 * 解码 JWT Token (不验证签名)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const payload = jose.decodeJwt(token);
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 从请求头获取 Token
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * 检查 Token 是否即将过期 (1 小时内)
 */
export function isTokenExpiringSoon(payload: JWTPayload): boolean {
  if (!payload.exp) return false;

  const expiryTime = payload.exp * 1000; // 转换为毫秒
  const oneHour = 60 * 60 * 1000;

  return expiryTime - Date.now() < oneHour;
}
