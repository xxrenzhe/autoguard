import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import dns from 'dns/promises';

// 设置自定义域名的验证 schema
const setDomainSchema = z.object({
  domain: z.string().min(1).max(255).regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/),
});

type Params = { params: Promise<{ id: string }> };

// CNAME 目标域名
const CNAME_TARGET = 'cname.autoguard.dev';

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

  return NextResponse.json({
    success: true,
    data: {
      custom_domain: offer.custom_domain,
      custom_domain_status: offer.custom_domain_status,
      custom_domain_verified_at: offer.custom_domain_verified_at,
      cname_target: CNAME_TARGET,
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

    // 设置自定义域名，状态为 pending
    execute(
      `UPDATE offers SET
        custom_domain = ?,
        custom_domain_status = 'pending',
        custom_domain_verified_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [domain, offerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        custom_domain: domain,
        custom_domain_status: 'pending',
        cname_target: CNAME_TARGET,
        instructions: `Add a CNAME record for ${domain} pointing to ${CNAME_TARGET}`,
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

// PUT /api/offers/[id]/custom-domain - 验证自定义域名
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

  try {
    // 验证 DNS CNAME 记录
    const cnameRecords = await dns.resolveCname(offer.custom_domain);

    const isVerified = cnameRecords.some(record =>
      record.toLowerCase() === CNAME_TARGET.toLowerCase()
    );

    if (isVerified) {
      execute(
        `UPDATE offers SET
          custom_domain_status = 'verified',
          custom_domain_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [offerId]
      );

      return NextResponse.json({
        success: true,
        data: {
          custom_domain: offer.custom_domain,
          custom_domain_status: 'verified',
          verified: true,
          message: 'Domain verified successfully',
        },
      });
    } else {
      execute(
        `UPDATE offers SET
          custom_domain_status = 'failed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [offerId]
      );

      return NextResponse.json({
        success: true,
        data: {
          custom_domain: offer.custom_domain,
          custom_domain_status: 'failed',
          verified: false,
          message: `CNAME record found but points to wrong target. Expected: ${CNAME_TARGET}, Found: ${cnameRecords.join(', ')}`,
        },
      });
    }
  } catch (error) {
    // DNS 查询失败
    const dnsError = error as NodeJS.ErrnoException;

    if (dnsError.code === 'ENODATA' || dnsError.code === 'ENOTFOUND') {
      return NextResponse.json({
        success: true,
        data: {
          custom_domain: offer.custom_domain,
          custom_domain_status: 'pending',
          verified: false,
          message: 'CNAME record not found. Please add a CNAME record pointing to ' + CNAME_TARGET,
        },
      });
    }

    console.error('DNS verification error:', error);
    return NextResponse.json(
      { error: { code: 'DNS_ERROR', message: 'Failed to verify DNS records' } },
      { status: 500 }
    );
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

  execute(
    `UPDATE offers SET
      custom_domain = NULL,
      custom_domain_status = NULL,
      custom_domain_verified_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [offerId]
  );

  return NextResponse.json({
    success: true,
    message: 'Custom domain removed',
  });
}
