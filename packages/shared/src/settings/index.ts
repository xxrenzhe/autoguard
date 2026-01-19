import { queryAll, queryOne, execute } from '../db/connection.js';
import { encrypt, decrypt } from '../utils/crypto.js';

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
export function getSetting<T = string>(
  category: SettingCategory,
  key: string,
  userId?: number
): T | null {
  // 先查用户级设置
  if (userId) {
    const userSetting = queryOne<SystemSetting>(
      'SELECT * FROM system_settings WHERE user_id = ? AND category = ? AND key = ?',
      [userId, category, key]
    );

    if (userSetting) {
      return parseSettingValue<T>(userSetting);
    }
  }

  // 再查全局设置
  const globalSetting = queryOne<SystemSetting>(
    'SELECT * FROM system_settings WHERE user_id IS NULL AND category = ? AND key = ?',
    [category, key]
  );

  if (globalSetting) {
    return parseSettingValue<T>(globalSetting);
  }

  return null;
}

/**
 * 设置值
 */
export function setSetting(
  category: SettingCategory,
  key: string,
  value: unknown,
  userId?: number,
  options?: {
    isSensitive?: boolean;
    dataType?: 'string' | 'number' | 'boolean' | 'json';
  }
): void {
  const existing = queryOne<SystemSetting>(
    'SELECT * FROM system_settings WHERE user_id IS ? AND category = ? AND key = ?',
    [userId ?? null, category, key]
  );

  const isSensitive = options?.isSensitive || false;
  const dataType = options?.dataType || 'string';

  let storedValue: string | null = null;
  let encryptedValue: string | null = null;

  if (value !== null && value !== undefined) {
    const stringValue = dataType === 'json' ? JSON.stringify(value) : String(value);

    if (isSensitive) {
      encryptedValue = encrypt(stringValue);
    } else {
      storedValue = stringValue;
    }
  }

  if (existing) {
    execute(
      `UPDATE system_settings
       SET value = ?, encrypted_value = ?, data_type = ?, is_sensitive = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [storedValue, encryptedValue, dataType, isSensitive ? 1 : 0, existing.id]
    );
  } else {
    execute(
      `INSERT INTO system_settings (user_id, category, key, value, encrypted_value, data_type, is_sensitive)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId ?? null, category, key, storedValue, encryptedValue, dataType, isSensitive ? 1 : 0]
    );
  }
}

/**
 * 获取分类下所有设置
 */
export function getSettingsByCategory(
  category: SettingCategory,
  userId?: number
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  // 全局设置
  const globalSettings = queryAll<SystemSetting>(
    'SELECT * FROM system_settings WHERE user_id IS NULL AND category = ?',
    [category]
  );

  for (const setting of globalSettings) {
    settings[setting.key] = parseSettingValue(setting);
  }

  // 用户设置覆盖
  if (userId) {
    const userSettings = queryAll<SystemSetting>(
      'SELECT * FROM system_settings WHERE user_id = ? AND category = ?',
      [userId, category]
    );

    for (const setting of userSettings) {
      settings[setting.key] = parseSettingValue(setting);
    }
  }

  return settings;
}

/**
 * 删除设置
 */
export function deleteSetting(
  category: SettingCategory,
  key: string,
  userId?: number
): void {
  execute(
    'DELETE FROM system_settings WHERE user_id IS ? AND category = ? AND key = ?',
    [userId ?? null, category, key]
  );
}

/**
 * 解析设置值
 */
function parseSettingValue<T>(setting: SystemSetting): T {
  let rawValue: string | null = null;

  if (setting.is_sensitive && setting.encrypted_value) {
    rawValue = decrypt(setting.encrypted_value);
  } else {
    rawValue = setting.value;
  }

  if (rawValue === null) {
    return null as T;
  }

  switch (setting.data_type) {
    case 'number':
      return parseFloat(rawValue) as T;
    case 'boolean':
      return (rawValue === 'true' || rawValue === '1') as T;
    case 'json':
      try {
        return JSON.parse(rawValue) as T;
      } catch {
        return rawValue as T;
      }
    default:
      return rawValue as T;
  }
}

/**
 * 常用设置快捷方法
 */
export const Settings = {
  // AI 设置
  getGeminiApiKey: (userId?: number) =>
    getSetting<string>('ai', 'gemini_api_key', userId),

  setGeminiApiKey: (apiKey: string, userId?: number) =>
    setSetting('ai', 'gemini_api_key', apiKey, userId, { isSensitive: true }),

  getGeminiModel: (userId?: number) =>
    getSetting<string>('ai', 'gemini_model', userId) || 'gemini-1.5-flash',

  // 代理设置
  getProxyUrl: (userId?: number) =>
    getSetting<string>('proxy', 'proxy_url', userId),

  isProxyEnabled: (userId?: number) =>
    getSetting<boolean>('proxy', 'proxy_enabled', userId) || false,

  // 系统设置
  getLogRetentionDays: () =>
    getSetting<number>('system', 'log_retention_days') || 30,

  getMaxPagesPerOffer: () =>
    getSetting<number>('system', 'max_pages_per_offer') || 10,

  // Cloak 设置
  getCloakTimeout: () =>
    getSetting<number>('cloak', 'decision_timeout_ms') || 100,

  getSafeModeThreshold: () =>
    getSetting<number>('cloak', 'safe_mode_threshold') || 50,
};
