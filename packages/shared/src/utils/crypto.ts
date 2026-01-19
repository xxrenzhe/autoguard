import crypto from 'crypto';

// 加密密钥 (生产环境应从环境变量获取)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'autoguard-encryption-key-32bytes!';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 加密字符串
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // 格式: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 解密字符串
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const [ivHex, authTagHex, encrypted] = parts;

  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted!, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * 生成随机字节 (hex)
 */
export function randomBytes(length: number): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * 计算 SHA256 哈希
 */
export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * 计算 HMAC-SHA256
 */
export function hmacSha256(text: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

/**
 * 生成安全的随机 ID
 */
export function generateSecureId(length: number = 16): string {
  const bytes = crypto.randomBytes(length);
  return bytes.toString('base64url').substring(0, length);
}
