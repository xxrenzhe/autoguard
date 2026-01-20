export interface SystemSetting {
    id: number;
    user_id: number | null;
    category: string;
    key: string;
    value: string | null;
    encrypted_value: string | null;
    data_type: 'string' | 'number' | 'boolean' | 'json';
    is_sensitive: number;
    is_required: number;
    validation_status: string | null;
    validation_message: string | null;
    description: string | null;
    created_at: string;
    updated_at: string;
}
export type SettingCategory = 'ai' | 'proxy' | 'system' | 'cloak';
/**
 * 获取设置值
 */
export declare function getSetting<T = string>(category: SettingCategory, key: string, userId?: number): T | null;
/**
 * 设置值
 */
export declare function setSetting(category: SettingCategory, key: string, value: unknown, userId?: number, options?: {
    isSensitive?: boolean;
    dataType?: 'string' | 'number' | 'boolean' | 'json';
}): void;
/**
 * 获取分类下所有设置
 */
export declare function getSettingsByCategory(category: SettingCategory, userId?: number): Record<string, unknown>;
/**
 * 删除设置
 */
export declare function deleteSetting(category: SettingCategory, key: string, userId?: number): void;
/**
 * 常用设置快捷方法
 */
export declare const Settings: {
    getGeminiApiKey: (userId?: number) => string | null;
    setGeminiApiKey: (apiKey: string, userId?: number) => void;
    getGeminiModel: (userId?: number) => string;
    getProxyUrl: (userId?: number) => string | null;
    isProxyEnabled: (userId?: number) => boolean;
    getLogRetentionDays: () => number;
    getMaxPagesPerOffer: () => number;
    getCloakTimeout: () => number;
    getSafeModeThreshold: () => number;
};
//# sourceMappingURL=index.d.ts.map