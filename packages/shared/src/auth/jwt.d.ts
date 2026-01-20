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
export declare function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string>;
/**
 * 验证 JWT Token
 */
export declare function verifyToken(token: string): Promise<JWTPayload | null>;
/**
 * 验证 JWT Token (Edge Runtime 兼容)
 */
export declare function verifyTokenEdge(token: string): Promise<JWTPayload | null>;
/**
 * 解码 JWT Token (不验证签名)
 */
export declare function decodeToken(token: string): JWTPayload | null;
/**
 * 从请求头获取 Token
 */
export declare function extractTokenFromHeader(authHeader: string | null): string | null;
/**
 * 检查 Token 是否即将过期 (1 小时内)
 */
export declare function isTokenExpiringSoon(payload: JWTPayload): boolean;
//# sourceMappingURL=jwt.d.ts.map