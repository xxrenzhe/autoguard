import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '@autoguard/shared';
import type {
  BlacklistIP,
  BlacklistIPRange,
  BlacklistUA,
  BlacklistISP,
  BlacklistGeo,
} from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

// Blacklist types
type BlacklistType = 'ip' | 'ip_range' | 'ua' | 'isp' | 'geo';

// Table configuration
const tableConfig: Record<
  BlacklistType,
  {
    tableName: string;
    valueColumn: string;
    additionalColumns?: string[];
  }
> = {
  ip: {
    tableName: 'blacklist_ips',
    valueColumn: 'ip_address',
  },
  ip_range: {
    tableName: 'blacklist_ip_ranges',
    valueColumn: 'cidr',
  },
  ua: {
    tableName: 'blacklist_uas',
    valueColumn: 'pattern',
    additionalColumns: ['pattern_type', 'description'],
  },
  isp: {
    tableName: 'blacklist_isps',
    valueColumn: 'asn',
    additionalColumns: ['isp_name'],
  },
  geo: {
    tableName: 'blacklist_geos',
    valueColumn: 'country_code',
    additionalColumns: ['region_code', 'block_type'],
  },
};

// Query parameters schema
const queryParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.enum(['ip', 'ip_range', 'ua', 'isp', 'geo']),
  search: z.string().optional(),
  scope: z.enum(['global', 'user']).optional().default('global'),
});

// Add entry schema
const addEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ip'),
    value: z.string().ip({ version: 'v4' }),
    reason: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
    expires_at: z.string().datetime().optional().nullable(),
  }),
  z.object({
    type: z.literal('ip_range'),
    value: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, 'Invalid CIDR format'),
    reason: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
    expires_at: z.string().datetime().optional().nullable(),
  }),
  z.object({
    type: z.literal('ua'),
    value: z.string().min(1).max(255),
    pattern_type: z.enum(['exact', 'contains', 'regex']).optional().default('contains'),
    description: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('isp'),
    asn: z.string().optional(),
    isp_name: z.string().optional(),
    reason: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('geo'),
    country_code: z.string().length(2).toUpperCase(),
    region_code: z.string().optional(),
    block_type: z.enum(['block', 'high_risk']).optional().default('block'),
    reason: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
  }),
]);

// Bulk add schema
const bulkAddSchema = z.object({
  type: z.enum(['ip', 'ip_range', 'ua', 'isp', 'geo']),
  scope: z.enum(['global', 'user']).optional().default('user'),
  entries: z
    .array(
      z.object({
        value: z.string().min(1).max(255),
        reason: z.string().max(500).optional(),
        source: z.string().max(100).optional(),
        expires_at: z.string().datetime().optional().nullable(),
        // Additional fields for specific types
        pattern_type: z.string().optional(),
        description: z.string().optional(),
        asn: z.string().optional(),
        isp_name: z.string().optional(),
        country_code: z.string().optional(),
        region_code: z.string().optional(),
        block_type: z.string().optional(),
      })
    )
    .min(1)
    .max(1000),
});

// GET /api/blacklist - Get blacklist entries
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const params = queryParamsSchema.parse({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 50,
      type: searchParams.get('type') || 'ip',
      search: searchParams.get('search'),
      scope: searchParams.get('scope') || 'global',
    });

    const config = tableConfig[params.type];
    const offset = (params.page - 1) * params.limit;

    // Build query
    const isGlobal = params.scope === 'global';
    let sql = `SELECT * FROM ${config.tableName} WHERE is_active = 1`;
    const sqlParams: unknown[] = [];

    if (isGlobal) {
      sql += ' AND user_id IS NULL';
    } else {
      sql += ' AND user_id = ?';
      sqlParams.push(user.userId);
    }

    if (params.search) {
      sql += ` AND ${config.valueColumn} LIKE ?`;
      sqlParams.push(`%${params.search}%`);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    sqlParams.push(params.limit, offset);

    const entries = queryAll<Record<string, unknown>>(sql, sqlParams);

    // Get total count
    let countSql = `SELECT COUNT(*) as count FROM ${config.tableName} WHERE is_active = 1`;
    const countParams: unknown[] = [];
    if (isGlobal) {
      countSql += ' AND user_id IS NULL';
    } else {
      countSql += ' AND user_id = ?';
      countParams.push(user.userId);
    }
    if (params.search) {
      countSql += ` AND ${config.valueColumn} LIKE ?`;
      countParams.push(`%${params.search}%`);
    }
    const countResult = queryOne<{ count: number }>(countSql, countParams);
    const total = countResult?.count || 0;

    // Get stats for all types
    const stats = {
      ip:
        queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM blacklist_ips WHERE is_active = 1 AND user_id IS NULL'
        )?.count || 0,
      ip_range:
        queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM blacklist_ip_ranges WHERE is_active = 1 AND user_id IS NULL'
        )?.count || 0,
      ua:
        queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM blacklist_uas WHERE is_active = 1 AND user_id IS NULL'
        )?.count || 0,
      isp:
        queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM blacklist_isps WHERE is_active = 1 AND user_id IS NULL'
        )?.count || 0,
      geo:
        queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM blacklist_geos WHERE is_active = 1 AND user_id IS NULL'
        )?.count || 0,
    };

    return NextResponse.json({
      success: true,
      data: entries,
      meta: { page: params.page, limit: params.limit, total },
      stats,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid parameters', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Fetch blacklist error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// POST /api/blacklist - Add blacklist entry
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  // Only admin can modify global blacklist
  const isAdmin = user.role === 'admin';

  try {
    const body = await request.json();
    const scope = body.scope || 'user'; // Default to user scope

    // Check permission: only admin can write to global blacklist
    if (scope === 'global' && !isAdmin) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only administrators can modify global blacklist' } },
        { status: 403 }
      );
    }

    // Determine user_id based on scope
    const targetUserId = scope === 'global' ? null : user.userId;

    // Check if bulk add
    if (body.entries) {
      const data = bulkAddSchema.parse(body);
      const config = tableConfig[data.type];

      let added = 0;
      let skipped = 0;

      for (const entry of data.entries) {
        const value = entry.value || entry[config.valueColumn as keyof typeof entry];
        if (!value) continue;

        // Check if exists
        const existingQuery = targetUserId === null
          ? `SELECT id, is_active FROM ${config.tableName} WHERE ${config.valueColumn} = ? AND user_id IS NULL`
          : `SELECT id, is_active FROM ${config.tableName} WHERE ${config.valueColumn} = ? AND user_id = ?`;
        const existingParams = targetUserId === null ? [value] : [value, targetUserId];

        const existing = queryOne<{ id: number; is_active: number }>(existingQuery, existingParams);

        if (existing) {
          if (!existing.is_active) {
            // Reactivate
            execute(
              `UPDATE ${config.tableName} SET is_active = 1, reason = ?, source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [entry.reason || null, entry.source || 'bulk_import', existing.id]
            );
          }
          skipped++;
        } else {
          // Insert based on type
          insertEntry(data.type, entry, targetUserId);
          added++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Added ${added} entries, skipped ${skipped} existing entries`,
        added,
        skipped,
      });
    }

    // Single entry add
    const data = addEntrySchema.parse(body);
    const config = tableConfig[data.type];

    // Determine value column
    let value: string;
    if (data.type === 'ip' || data.type === 'ip_range' || data.type === 'ua') {
      value = data.value;
    } else if (data.type === 'isp') {
      value = data.asn || '';
    } else {
      value = data.country_code;
    }

    // Check if exists
    const existingQuery = targetUserId === null
      ? `SELECT id, is_active FROM ${config.tableName} WHERE ${config.valueColumn} = ? AND user_id IS NULL`
      : `SELECT id, is_active FROM ${config.tableName} WHERE ${config.valueColumn} = ? AND user_id = ?`;
    const existingParams = targetUserId === null ? [value] : [value, targetUserId];

    const existing = queryOne<{ id: number; is_active: number }>(existingQuery, existingParams);

    if (existing) {
      if (existing.is_active) {
        return NextResponse.json(
          { error: { code: 'DUPLICATE', message: 'Entry already exists' } },
          { status: 400 }
        );
      }

      // Reactivate
      execute(
        `UPDATE ${config.tableName} SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing.id]
      );

      return NextResponse.json({
        success: true,
        message: 'Entry reactivated',
        id: existing.id,
      });
    }

    // Insert new entry
    const result = insertEntry(data.type, data as Record<string, unknown>, targetUserId);

    return NextResponse.json({
      success: true,
      message: 'Entry added',
      id: result.lastInsertRowid,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Add blacklist error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// DELETE /api/blacklist - Remove blacklist entry
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as BlacklistType | null;
    const id = searchParams.get('id');

    if (!type || !id) {
      return NextResponse.json(
        { error: { code: 'MISSING_PARAMS', message: 'Missing type or id' } },
        { status: 400 }
      );
    }

    const config = tableConfig[type];
    if (!config) {
      return NextResponse.json(
        { error: { code: 'INVALID_TYPE', message: 'Invalid blacklist type' } },
        { status: 400 }
      );
    }

    const entryId = parseInt(id, 10);

    // Soft delete
    execute(
      `UPDATE ${config.tableName} SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [entryId]
    );

    return NextResponse.json({
      success: true,
      message: 'Entry removed',
    });
  } catch (error) {
    console.error('Delete blacklist error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// Helper function to insert entry based on type
function insertEntry(
  type: BlacklistType,
  data: Record<string, unknown>,
  userId: number | null
): { lastInsertRowid: number | bigint } {
  switch (type) {
    case 'ip':
      return execute(
        `INSERT INTO blacklist_ips (user_id, ip_address, reason, source, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, data.value, data.reason || null, data.source || 'manual', data.expires_at || null]
      );

    case 'ip_range':
      return execute(
        `INSERT INTO blacklist_ip_ranges (user_id, cidr, reason, source, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, data.value, data.reason || null, data.source || 'manual', data.expires_at || null]
      );

    case 'ua':
      return execute(
        `INSERT INTO blacklist_uas (user_id, pattern, pattern_type, description, source)
         VALUES (?, ?, ?, ?, ?)`,
        [
          userId,
          data.value,
          data.pattern_type || 'contains',
          data.description || null,
          data.source || 'manual',
        ]
      );

    case 'isp':
      return execute(
        `INSERT INTO blacklist_isps (user_id, asn, isp_name, reason, source)
         VALUES (?, ?, ?, ?, ?)`,
        [
          userId,
          data.asn || null,
          data.isp_name || null,
          data.reason || null,
          data.source || 'manual',
        ]
      );

    case 'geo':
      return execute(
        `INSERT INTO blacklist_geos (user_id, country_code, region_code, block_type, reason, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          data.country_code,
          data.region_code || null,
          data.block_type || 'block',
          data.reason || null,
          data.source || 'manual',
        ]
      );

    default:
      throw new Error(`Unknown blacklist type: ${type}`);
  }
}
