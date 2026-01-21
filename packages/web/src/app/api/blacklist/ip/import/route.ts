import { z } from 'zod';
import { execute, queryOne, syncIPBlacklist, isValidIPv4 } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type ImportItem = {
  line: number;
  ip: string;
  reason?: string | null;
};

const jsonImportSchema = z.object({
  scope: z.enum(['global', 'user']).optional(),
  source: z.string().max(100).optional(),
  ips: z
    .array(
      z
        .object({
          ip: z.string().optional(),
          ip_address: z.string().optional(),
          value: z.string().optional(),
          reason: z.string().max(500).optional(),
        })
        .refine((item) => Boolean(item.ip || item.ip_address || item.value), {
          message: 'ip is required',
        })
    )
    .min(1)
    .max(10000),
});

function parseDelimitedLine(
  rawLine: string,
  lineNumber: number,
  defaultReason?: string | null
): ImportItem | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (line.startsWith('#') || line.startsWith('//')) return null;

  // Skip common headers
  const lower = line.toLowerCase();
  if (lower.includes('ip') && (lower.includes('reason') || lower.includes('ip_address'))) {
    return null;
  }

  let ip = '';
  let reason: string | null | undefined;

  if (line.includes(',')) {
    const [first, ...rest] = line.split(',');
    ip = (first || '').trim().replace(/^"|"$/g, '');
    const reasonJoined = rest.join(',').trim();
    reason = reasonJoined ? reasonJoined.replace(/^"|"$/g, '') : defaultReason;
  } else {
    const parts = line.split(/\s+/);
    ip = (parts[0] || '').trim().replace(/^"|"$/g, '');
    const remaining = parts.slice(1).join(' ').trim();
    reason = remaining ? remaining.replace(/^"|"$/g, '') : defaultReason;
  }

  if (!ip) return null;

  return { line: lineNumber, ip, reason };
}

function parseFileText(text: string, defaultReason?: string | null): ImportItem[] {
  const lines = text.split(/\r?\n/);
  const items: ImportItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseDelimitedLine(lines[i] || '', i + 1, defaultReason);
    if (parsed) items.push(parsed);
  }

  return items;
}

async function upsertIp(
  item: ImportItem,
  targetUserId: number | null,
  source: string
): Promise<'imported' | 'skipped'> {
  const lookupSql =
    targetUserId === null
      ? `SELECT id, is_active FROM blacklist_ips WHERE ip_address = ? AND user_id IS NULL`
      : `SELECT id, is_active FROM blacklist_ips WHERE ip_address = ? AND user_id = ?`;
  const lookupParams = targetUserId === null ? [item.ip] : [item.ip, targetUserId];

  const existing = queryOne<{ id: number; is_active: number }>(lookupSql, lookupParams);

  if (existing) {
    if (!existing.is_active) {
      execute(
        `UPDATE blacklist_ips
         SET is_active = 1, reason = ?, source = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.reason || null, source, existing.id]
      );
    }
    return 'skipped';
  }

  execute(
    `INSERT INTO blacklist_ips (user_id, ip_address, reason, source, expires_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [targetUserId, item.ip, item.reason || null, source]
  );

  return 'imported';
}

// POST /api/blacklist/ip/import - Bulk import IPs (SystemDesign2)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const contentType = request.headers.get('content-type') || '';

  try {
    let scope: 'global' | 'user' = 'user';
    let source = 'import';
    let items: ImportItem[] = [];

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');

      if (!(file instanceof File)) {
        return errors.validation('Missing file', { field: 'file' });
      }

      const scopeRaw = form.get('scope');
      if (typeof scopeRaw === 'string' && (scopeRaw === 'global' || scopeRaw === 'user')) {
        scope = scopeRaw;
      }

      const sourceRaw = form.get('source');
      if (typeof sourceRaw === 'string' && sourceRaw.trim()) {
        source = sourceRaw.trim();
      }

      const defaultReasonRaw = form.get('reason');
      const defaultReason =
        typeof defaultReasonRaw === 'string' && defaultReasonRaw.trim()
          ? defaultReasonRaw.trim()
          : null;

      const text = await file.text();
      items = parseFileText(text, defaultReason);
    } else {
      const body = await request.json().catch(() => ({}));
      const parsed = jsonImportSchema.parse(body);
      scope = parsed.scope || 'user';
      source = parsed.source || 'import';
      items = parsed.ips.map((item, idx) => ({
        line: idx + 1,
        ip: (item.ip || item.ip_address || item.value || '').trim(),
        reason: item.reason || null,
      }));
    }

    if (scope === 'global' && user.role !== 'admin') {
      return errors.forbidden('Only administrators can import into global blacklist');
    }

    const targetUserId = scope === 'global' ? null : user.userId;

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errorsList: Array<{ line: number; ip: string; error: string }> = [];

    for (const item of items) {
      const ip = item.ip.trim();
      if (!ip) continue;

      if (!isValidIPv4(ip)) {
        failed++;
        errorsList.push({ line: item.line, ip, error: '无效的 IP 格式' });
        continue;
      }

      try {
        const result = await upsertIp({ ...item, ip }, targetUserId, source);
        if (result === 'imported') imported++;
        else skipped++;
      } catch (err) {
        failed++;
        errorsList.push({
          line: item.line,
          ip,
          error: err instanceof Error ? err.message : '导入失败',
        });
      }
    }

    // Refresh Redis caches so changes take effect immediately.
    try {
      await syncIPBlacklist();
    } catch (err) {
      console.error('Failed to sync IP blacklist after import:', err);
    }

    return success(
      {
        imported,
        skipped,
        failed,
        errors: errorsList,
      },
      `导入完成: ${imported} 成功, ${skipped} 跳过, ${failed} 失败`
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('IP import error:', error);
    return errors.internal('Failed to import IPs');
  }
}

