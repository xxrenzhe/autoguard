import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, error as apiError, errors } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

const VERIFY_TIMEOUT_MS = 5000;

function buildTxtDomain(domain: string): string {
  const parts = domain.split('.');
  const firstLabel = parts[0] || '';
  const parentDomain = parts.slice(1).join('.');
  const txtHost = `_autoguard.${firstLabel}`;
  return parentDomain ? `${txtHost}.${parentDomain}` : txtHost;
}

function buildExpectedTxtValue(token: string): string {
  return `ag-verify=${token}`;
}

async function invalidateOfferCache(offer: Offer): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
    await redis.del(CacheKeys.offer.byId(offer.id));
    if (offer.custom_domain) {
      await redis.del(CacheKeys.offer.byDomain(offer.custom_domain));
    }
  } catch (err) {
    console.error('Redis cache invalidation failed:', err);
  }
}

// POST /api/offers/[id]/custom-domain/verify - Verify custom domain (TXT + HTTP ping)
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

  if (!offer.custom_domain) {
    return errors.validation('No custom domain configured');
  }

  if (!offer.custom_domain_token) {
    return errors.validation('No verification token found. Please reconfigure the domain.');
  }

  if (offer.custom_domain_status === 'verified' && offer.custom_domain_verified_at) {
    return success(
      {
        domain: offer.custom_domain,
        status: 'verified',
        verified_at: offer.custom_domain_verified_at,
      },
      '域名已验证'
    );
  }

  const domain = offer.custom_domain;
  const expectedToken = offer.custom_domain_token;
  const expectedTxtValue = buildExpectedTxtValue(expectedToken);
  const pingUrl = `https://${domain}/__autoguard/ping`;
  const txtDomain = buildTxtDomain(domain);

  let txtOk = false;
  let httpOk = false;
  let txtFound: string | null = null;

  // 1) TXT verification
  try {
    const dns = await import('dns/promises');
    const txtRecords = await dns.resolveTxt(txtDomain);
    const flatRecords = txtRecords.flat().filter(Boolean);

    txtFound = flatRecords.length > 0 ? flatRecords.join(', ') : null;
    txtOk = flatRecords.includes(expectedTxtValue);
  } catch (dnsError: unknown) {
    const err = dnsError as NodeJS.ErrnoException;
    if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      console.error('TXT verification DNS error:', dnsError);
    }
    txtFound = null;
    txtOk = false;
  }

  // 2) HTTP ping verification
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    const response = await fetch(pingUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'AutoGuard-DomainVerifier/1.0' },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const text = (await response.text()).trim();
      httpOk = text === 'ok';
    } else {
      httpOk = false;
    }
  } catch (httpError) {
    httpOk = false;
  }

  const verified = txtOk && httpOk;

  if (verified) {
    execute(
      `UPDATE offers SET
        custom_domain_status = 'verified',
        custom_domain_verified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [offerId]
    );

    // Ensure Cloak Worker picks up changes immediately
    await invalidateOfferCache(offer);

    return success(
      {
        domain,
        status: 'verified',
        verified_at: new Date().toISOString(),
      },
      '域名验证成功'
    );
  }

  // Mark as failed per normalization spec
  execute(
    `UPDATE offers SET
      custom_domain_status = 'failed',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [offerId]
  );

  await invalidateOfferCache(offer);

  return apiError('DOMAIN_VERIFICATION_FAILED', 'DNS 记录未正确配置', 400, {
    txt_ok: txtOk,
    http_ok: httpOk,
    txt_expected: expectedTxtValue,
    txt_found: txtFound,
    ping_url: pingUrl,
  });
}
