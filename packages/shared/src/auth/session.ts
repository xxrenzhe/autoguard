import { getRedis } from '../cache/index.js';

const SESSION_PREFIX = 'autoguard:session:';
const SESSION_TTL = 7 * 24 * 60 * 60; // 7 天 (秒)

export interface SessionData {
  userId: number;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastActiveAt: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * 生成 Session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}`;
}

/**
 * 创建 Session
 */
export async function createSession(
  sessionId: string,
  data: Omit<SessionData, 'createdAt' | 'lastActiveAt'>
): Promise<void> {
  const redis = getRedis();
  const now = new Date().toISOString();

  const sessionData: SessionData = {
    ...data,
    createdAt: now,
    lastActiveAt: now,
  };

  await redis.set(
    `${SESSION_PREFIX}${sessionId}`,
    JSON.stringify(sessionData),
    'EX',
    SESSION_TTL
  );

  // 记录用户的所有活跃 session
  await redis.sadd(`${SESSION_PREFIX}user:${data.userId}`, sessionId);
}

/**
 * 获取 Session
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const redis = getRedis();
  const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);

  if (!data) return null;

  try {
    return JSON.parse(data) as SessionData;
  } catch {
    return null;
  }
}

/**
 * 更新 Session 最后活跃时间
 */
export async function touchSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  const session = await getSession(sessionId);

  if (session) {
    session.lastActiveAt = new Date().toISOString();
    await redis.set(
      `${SESSION_PREFIX}${sessionId}`,
      JSON.stringify(session),
      'EX',
      SESSION_TTL
    );
  }
}

/**
 * 删除 Session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  const session = await getSession(sessionId);

  if (session) {
    await redis.del(`${SESSION_PREFIX}${sessionId}`);
    await redis.srem(`${SESSION_PREFIX}user:${session.userId}`, sessionId);
  }
}

/**
 * 删除用户所有 Session (登出所有设备)
 */
export async function deleteAllUserSessions(userId: number): Promise<void> {
  const redis = getRedis();
  const sessionIds = await redis.smembers(`${SESSION_PREFIX}user:${userId}`);

  if (sessionIds.length > 0) {
    await redis.del(...sessionIds.map(id => `${SESSION_PREFIX}${id}`));
    await redis.del(`${SESSION_PREFIX}user:${userId}`);
  }
}

/**
 * 获取用户所有活跃 Session
 */
export async function getUserSessions(userId: number): Promise<SessionData[]> {
  const redis = getRedis();
  const sessionIds = await redis.smembers(`${SESSION_PREFIX}user:${userId}`);

  const sessions: SessionData[] = [];
  for (const sessionId of sessionIds) {
    const session = await getSession(sessionId);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}
