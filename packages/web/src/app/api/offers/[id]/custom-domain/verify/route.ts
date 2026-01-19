import { NextResponse } from 'next/server';
import { queryOne, execute } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import dns from 'dns/promises';

type Params = { params: Promise<{ id: string }> };

// CNAME target domain
const CNAME_TARGET = 'cname.autoguard.dev';

// Verification token prefix
const VERIFICATION_PREFIX = 'ag-verify=';

/**
 * Generate verification token for a domain
 */
function generateVerificationToken(subdomain: string): string {
  // Create a deterministic token based on subdomain
  const hash = Buffer.from(subdomain + 'autoguard').toString('base64').slice(0, 12);
  return hash.replace(/[+/=]/g, '');
}

// POST /api/offers/[id]/custom-domain/verify - Verify domain DNS configuration
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

  if (!offer.custom_domain) {
    return NextResponse.json(
      { error: { code: 'NO_DOMAIN', message: 'No custom domain configured' } },
      { status: 400 }
    );
  }

  const verificationErrors: Array<{
    type: string;
    expected: string;
    actual: string | null;
    message: string;
  }> = [];

  let cnameVerified = false;
  let txtVerified = false;
  const verificationToken = generateVerificationToken(offer.subdomain);
  const expectedTxtValue = `${VERIFICATION_PREFIX}${verificationToken}`;

  // Check CNAME record
  try {
    const cnameRecords = await dns.resolveCname(offer.custom_domain);
    cnameVerified = cnameRecords.some(
      record => record.toLowerCase() === CNAME_TARGET.toLowerCase()
    );

    if (!cnameVerified) {
      verificationErrors.push({
        type: 'CNAME',
        expected: CNAME_TARGET,
        actual: cnameRecords.join(', ') || null,
        message: 'CNAME record points to wrong target',
      });
    }
  } catch (error) {
    const dnsError = error as NodeJS.ErrnoException;
    verificationErrors.push({
      type: 'CNAME',
      expected: CNAME_TARGET,
      actual: null,
      message: dnsError.code === 'ENODATA' || dnsError.code === 'ENOTFOUND'
        ? 'CNAME record not found'
        : `DNS lookup failed: ${dnsError.code}`,
    });
  }

  // Check TXT record (optional but recommended)
  try {
    const domain = offer.custom_domain;
    // Try _autoguard.{domain} for TXT verification
    const txtHost = `_autoguard.${domain.split('.')[0]}`;
    const parentDomain = domain.split('.').slice(1).join('.');
    const txtDomain = parentDomain ? `${txtHost}.${parentDomain}` : txtHost;

    try {
      const txtRecords = await dns.resolveTxt(txtDomain);
      const flatRecords = txtRecords.flat();
      txtVerified = flatRecords.some(record => record === expectedTxtValue);
    } catch {
      // TXT record is optional, ignore errors
    }
  } catch {
    // TXT verification is optional
  }

  // Determine overall verification status
  const verified = cnameVerified; // CNAME is required, TXT is optional

  if (verified) {
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
        verified: true,
        custom_domain: offer.custom_domain,
        custom_domain_status: 'verified',
        custom_domain_verified_at: new Date().toISOString(),
        checks: {
          cname: { verified: cnameVerified },
          txt: { verified: txtVerified, optional: true },
        },
      },
      message: 'Domain verified successfully',
    });
  } else {
    // Update status to pending if not already failed
    if (offer.custom_domain_status !== 'pending') {
      execute(
        `UPDATE offers SET custom_domain_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [offerId]
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        verified: false,
        custom_domain: offer.custom_domain,
        custom_domain_status: 'pending',
        errors: verificationErrors,
        dns_records: [
          {
            type: 'CNAME',
            name: offer.custom_domain,
            value: CNAME_TARGET,
            required: true,
          },
          {
            type: 'TXT',
            name: `_autoguard.${offer.custom_domain.split('.')[0]}`,
            value: expectedTxtValue,
            required: false,
          },
        ],
      },
      message: 'DNS verification failed. Please check your DNS records.',
    });
  }
}
