/**
 * 对密码进行哈希
 */
export declare function hashPassword(password: string): Promise<string>;
/**
 * 验证密码
 */
export declare function verifyPassword(password: string, hashedPassword: string): Promise<boolean>;
/**
 * 生成随机密码
 */
export declare function generateRandomPassword(length?: number): string;
/**
 * 验证密码强度
 */
export declare function validatePasswordStrength(password: string): {
    valid: boolean;
    errors: string[];
};
//# sourceMappingURL=password.d.ts.map