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
export declare function generateSessionId(): string;
/**
 * 创建 Session
 */
export declare function createSession(sessionId: string, data: Omit<SessionData, 'createdAt' | 'lastActiveAt'>): Promise<void>;
/**
 * 获取 Session
 */
export declare function getSession(sessionId: string): Promise<SessionData | null>;
/**
 * 更新 Session 最后活跃时间
 */
export declare function touchSession(sessionId: string): Promise<void>;
/**
 * 删除 Session
 */
export declare function deleteSession(sessionId: string): Promise<void>;
/**
 * 删除用户所有 Session (登出所有设备)
 */
export declare function deleteAllUserSessions(userId: number): Promise<void>;
/**
 * 获取用户所有活跃 Session
 */
export declare function getUserSessions(userId: number): Promise<SessionData[]>;
//# sourceMappingURL=session.d.ts.map