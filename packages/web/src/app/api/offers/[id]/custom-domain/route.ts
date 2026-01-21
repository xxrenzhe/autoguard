import { z } from 'zod';
import { queryOne, execute, generateToken, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

// 设置自定义域名的验证 schema
const setDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    ),
});

type Params = { params: Promise<{ id: string }> };

// CNAME 目标域名
const CNAME_TARGET = 'cname.autoguard.dev';

function buildDnsRecords(domain: string, token: string | null) {
  const firstLabel = domain.split('.')[0] || domain;

  return {
    cname: {
      type: 'CNAME' as const,
      host: firstLabel,
      value: CNAME_TARGET,
      proxy_required: true,
    },
    txt: {
      type: 'TXT' as const,
      host: `_autoguard.${firstLabel}`,
      value: token ? `ag-verify=${token}` : null,
    },
  };
}

// GET /api/offers/[id]/custom-domain - 获取自定义域名状态
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  return success({
    domain: offer.custom_domain,
    status: offer.custom_domain_status,
    verified_at: offer.custom_domain_verified_at,
    token: offer.custom_domain_token,
    cname_target: CNAME_TARGET,
    dns_records: offer.custom_domain
      ? buildDnsRecords(offer.custom_domain, offer.custom_domain_token)
      : null,
  });
}

// POST /api/offers/[id]/custom-domain - 设置自定义域名
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
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
      return errors.conflict('This domain is already in use by another offer');
    }

    // 生成验证 Token（仅保存随机 token，TXT 记录值为 ag-verify={token}）
    const verificationToken = generateToken();

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

    // Best-effort invalidate offer caches
    try {
      const redis = getRedis();
      await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
      await redis.del(CacheKeys.offer.byId(offerId));
      await redis.del(CacheKeys.offer.byDomain(domain));
    } catch (redisError) {
      console.error('Redis cache invalidation failed:', redisError);
    }

    return success({
      domain,
      status: 'pending',
      dns_records: buildDnsRecords(domain, verificationToken),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid domain format', { errors: error.errors });
    }

    console.error('Set custom domain error:', error);
    return errors.internal();
  }
}

// DELETE /api/offers/[id]/custom-domain - 删除自定义域名
export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
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

  return success(
    {
      domain: null,
      status: 'none',
      custom_domain: null,
      custom_domain_status: 'none',
      access_urls: {
        system: `https://${offer.subdomain}.autoguard.dev`,
        custom: null,
      },
    },
    '已切换回自动子域名'
  );
}
