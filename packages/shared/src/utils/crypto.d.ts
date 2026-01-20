/**
 * 加密字符串
 */
export declare function encrypt(text: string): string;
/**
 * 解密字符串
 */
export declare function decrypt(encryptedText: string): string;
/**
 * 生成随机字节 (hex)
 */
export declare function randomBytes(length: number): string;
/**
 * 计算 SHA256 哈希
 */
export declare function sha256(text: string): string;
/**
 * 计算 HMAC-SHA256
 */
export declare function hmacSha256(text: string, secret: string): string;
/**
 * 生成安全的随机 ID
 */
export declare function generateSecureId(length?: number): string;
//# sourceMappingURL=crypto.d.ts.map