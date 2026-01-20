import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute, generateToken, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

// 设置自定义域名的验证 schema
const setDomainSchema = z.object({
  domain: z.string().min(1).max(255).regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/),
});

type Params = { params: Promise<{ id: string }> };

// CNAME 目标域名
const CNAME_TARGET = 'cname.autoguard.dev';

// 验证 Token 前缀
const VERIFICATION_PREFIX = 'ag-verify=';

// GET /api/offers/[id]/custom-domain - 获取自定义域名状态
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  // 构建 TXT 记录名称
  const txtRecordName = offer.custom_domain
    ? `_autoguard.${offer.custom_domain.split('.')[0]}`
    : null;

  return NextResponse.json({
    success: true,
    data: {
      custom_domain: offer.custom_domain,
      custom_domain_status: offer.custom_domain_status,
      custom_domain_verified_at: offer.custom_domain_verified_at,
      custom_domain_token: offer.custom_domain_token,
      cname_target: CNAME_TARGET,
      dns_records: offer.custom_domain ? [
        {
          type: 'CNAME',
          name: offer.custom_domain,
          value: CNAME_TARGET,
          required: true,
          note: 'Must enable Cloudflare proxy (orange cloud)',
        },
        {
          type: 'TXT',
          name: txtRecordName,
          value: offer.custom_domain_token || 'Token will be generated when domain is set',
          required: true,
          note: 'Used for ownership verification',
        },
      ] : null,
    },
  });
}

// POST /api/offers/[id]/custom-domain - 设置自定义域名
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const data = setDomainSchema.parse(body);
    const domain = data.domain.toLowerCase();

    // 检查域名是否已被其他 offer 使用
    const existingOffer = queryOne<{ id: number }>(
      'SELECT id FROM offers WHERE custom_domain = ? AND id != ? AND is_deleted = 0',
      [domain, offerId]
    );

    if (existingOffer) {
      return NextResponse.json(
        { error: { code: 'DOMAIN_IN_USE', message: 'This domain is already in use by another offer' } },
        { status: 400 }
      );
    }

    // 生成验证 Token
    const verificationToken = `${VERIFICATION_PREFIX}${generateToken()}`;

    // 设置自定义域名，状态为 pending，生成验证 token
    execute(
      `UPDATE offers SET
        custom_domain = ?,
        custom_domain_status = 'pending',
        custom_domain_token = ?,
        custom_domain_verified_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [domain, verificationToken, offerId]
    );

    // 构建 TXT 记录名称
    const txtRecordName = `_autoguard.${domain.split('.')[0]}`;

    return NextResponse.json({
      success: true,
      data: {
        custom_domain: domain,
        custom_domain_status: 'pending',
        custom_domain_token: verificationToken,
        cname_target: CNAME_TARGET,
        dns_records: [
          {
            type: 'CNAME',
            name: domain,
            value: CNAME_TARGET,
            required: true,
            note: 'Must enable Cloudflare proxy (orange cloud)',
          },
          {
            type: 'TXT',
            name: txtRecordName,
            value: verificationToken,
            required: true,
            note: 'Used for ownership verification',
          },
        ],
        instructions: `1. Add a CNAME record for ${domain} pointing to ${CNAME_TARGET} (with Cloudflare proxy enabled)\n2. Add a TXT record for ${txtRecordName} with value: ${verificationToken}`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid domain format', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Set custom domain error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// PUT /api/offers/[id]/custom-domain - 验证自定义域名 (TXT + HTTP ping)
export async function PUT(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  if (!offer.custom_domain) {
    return NextResponse.json(
      { error: { code: 'NO_DOMAIN', message: 'No custom domain configured' } },
      { status: 400 }
    );
  }

  if (!offer.custom_domain_token) {
    return NextResponse.json(
      { error: { code: 'NO_TOKEN', message: 'No verification token found. Please reconfigure the domain.' } },
      { status: 400 }
    );
  }

  const verificationErrors: Array<{
    type: string;
    expected: string;
    actual: string | null;
    message: string;
  }> = [];

  let txtVerified = false;
  let httpVerified = false;

  // 1. 验证 TXT 记录
  try {
    const dns = await import('dns/promises');
    const domain = offer.custom_domain;
    // TXT 记录名: _autoguard.{subdomain}.{domain}
    // 例如: promo.example.com -> _autoguard.promo.example.com
    const parts = domain.split('.');
    const txtHost = `_autoguard.${parts[0]}`;
    const parentDomain = parts.slice(1).join('.');
    const txtDomain = parentDomain ? `${txtHost}.${parentDomain}` : txtHost;

    try {
      const txtRecords = await dns.resolveTxt(txtDomain);
      const flatRecords = txtRecords.flat();
      txtVerified = flatRecords.some(record => record === offer.custom_domain_token);

      if (!txtVerified) {
        verificationErrors.push({
          type: 'TXT',
          expected: offer.custom_domain_token!,
          actual: flatRecords.join(', ') || null,
          message: `TXT record found but value doesn't match. Expected: ${offer.custom_domain_token}`,
        });
      }
    } catch (dnsError: unknown) {
      const err = dnsError as NodeJS.ErrnoException;
      verificationErrors.push({
        type: 'TXT',
        expected: offer.custom_domain_token!,
        actual: null,
        message: err.code === 'ENODATA' || err.code === 'ENOTFOUND'
          ? `TXT record not found at ${txtDomain}`
          : `DNS lookup failed: ${err.code}`,
      });
    }
  } catch (error) {
    console.error('TXT verification error:', error);
  }

  // 2. 验证 HTTP 可达性 (检查 /__autoguard/ping 端点)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://${offer.custom_domain}/__autoguard/ping`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AutoGuard-DomainVerifier/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      httpVerified = text.trim() === 'ok';

      if (!httpVerified) {
        verificationErrors.push({
          type: 'HTTP',
          expected: 'ok',
          actual: text.slice(0, 50),
          message: 'HTTP ping endpoint responded but with unexpected content',
        });
      }
    } else {
      verificationErrors.push({
        type: 'HTTP',
        expected: '200 OK',
        actual: `${response.status} ${response.statusText}`,
        message: `HTTP ping failed with status ${response.status}`,
      });
    }
  } catch (error: unknown) {
    const err = error as Error;
    verificationErrors.push({
      type: 'HTTP',
      expected: 'Connection to /__autoguard/ping',
      actual: null,
      message: err.name === 'AbortError'
        ? 'HTTP ping timed out (5s). Make sure the domain points to our servers.'
        : `HTTP ping failed: ${err.message}`,
    });
  }

  // 判定结果: TXT + HTTP 检查均需通过（Normalization 统一口径）
  const verified = txtVerified && httpVerified;

  if (verified) {
    execute(
      `UPDATE offers SET
        custom_domain_status = 'verified',
        custom_domain_verified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [offerId]
    );

    // Invalidate caches so Cloak Worker picks up verified domain immediately
    try {
      const redis = getRedis();
      await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
      await redis.del(CacheKeys.offer.byId(offerId));
      await redis.del(CacheKeys.offer.byDomain(offer.custom_domain));
    } catch (redisError) {
      console.error('Redis cache invalidation failed:', redisError);
    }

    return NextResponse.json({
      success: true,
      data: {
        verified: true,
        custom_domain: offer.custom_domain,
        custom_domain_status: 'verified',
        custom_domain_verified_at: new Date().toISOString(),
        checks: {
          txt: { verified: txtVerified },
          http: { verified: httpVerified },
        },
      },
      message: 'Domain verified successfully',
    });
  } else {
    // 验证失败，标记为 failed（Normalization 统一口径）
    execute(
      `UPDATE offers SET
        custom_domain_status = 'failed',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [offerId]
    );

    try {
      const redis = getRedis();
      await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
      await redis.del(CacheKeys.offer.byId(offerId));
      await redis.del(CacheKeys.offer.byDomain(offer.custom_domain));
    } catch (redisError) {
      console.error('Redis cache invalidation failed:', redisError);
    }

    return NextResponse.json({
      success: true,
      data: {
        verified: false,
        custom_domain: offer.custom_domain,
        custom_domain_status: 'failed',
        checks: {
          txt: { verified: txtVerified },
          http: { verified: httpVerified },
        },
        errors: verificationErrors,
        dns_records: [
          {
            type: 'CNAME',
            name: offer.custom_domain,
            value: CNAME_TARGET,
            required: true,
            note: 'Must enable Cloudflare proxy (orange cloud)',
          },
          {
            type: 'TXT',
            name: `_autoguard.${offer.custom_domain.split('.')[0]}`,
            value: offer.custom_domain_token,
            required: true,
            note: 'Used for ownership verification',
          },
        ],
      },
      message: 'Domain verification failed. Please check the errors and try again.',
    });
  }
}

// DELETE /api/offers/[id]/custom-domain - 删除自定义域名
export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  const oldDomain = offer.custom_domain;

  // Set status to 'none' instead of NULL per design spec
  execute(
    `UPDATE offers SET
      custom_domain = NULL,
      custom_domain_status = 'none',
      custom_domain_token = NULL,
      custom_domain_verified_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [offerId]
  );

  // Clear Redis cache for the old custom domain if it existed
  if (oldDomain) {
    try {
      const redis = getRedis();
      await redis.del(CacheKeys.offer.byDomain(oldDomain));
      // Also invalidate the main offer cache
      await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
      await redis.del(CacheKeys.offer.byId(offerId));
    } catch (redisError) {
      console.error('Redis cache invalidation failed:', redisError);
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Custom domain removed',
  });
}
