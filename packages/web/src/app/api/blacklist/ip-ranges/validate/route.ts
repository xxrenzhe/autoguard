import { z } from 'zod';
import { isValidCIDR } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';
import net from 'net';

const validateSchema = z.object({
  cidr: z.string().min(1),
});

function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  return (
    ((parseInt(parts[0]!, 10) << 24) |
      (parseInt(parts[1]!, 10) << 16) |
      (parseInt(parts[2]!, 10) << 8) |
      parseInt(parts[3]!, 10)) >>>
    0
  );
}

function numberToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

type CIDRRangeResult =
  | { version: 4; ipStart: string; ipEnd: string; totalIps: number }
  | { version: 6; ipStart: null; ipEnd: null; totalIps: null };

function cidrToRange(cidr: string): CIDRRangeResult {
  const [ip, prefixStr] = cidr.split('/');
  if (!ip || !prefixStr) {
    throw new Error('Invalid CIDR format');
  }

  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix)) {
    throw new Error('Invalid CIDR prefix');
  }

  const version = net.isIP(ip);
  if (version === 4) {
    if (prefix < 0 || prefix > 32) {
      throw new Error('Invalid CIDR prefix');
    }

    const ipNum = ipToNumber(ip);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ipNum & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const totalIps = Math.pow(2, 32 - prefix);

    return {
      version: 4,
      ipStart: numberToIp(network),
      ipEnd: numberToIp(broadcast),
      totalIps,
    };
  }

  if (version === 6) {
    if (prefix < 0 || prefix > 128) {
      throw new Error('Invalid CIDR prefix');
    }

    return {
      version: 6,
      ipStart: null,
      ipEnd: null,
      totalIps: null,
    };
  }

  throw new Error('Invalid IP version');
}

// POST /api/blacklist/ip-ranges/validate - Validate CIDR (SystemDesign2)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { cidr } = validateSchema.parse(body);

    if (!isValidCIDR(cidr)) {
      return success({ valid: false });
    }

    let range: ReturnType<typeof cidrToRange>;
    try {
      range = cidrToRange(cidr);
    } catch (err) {
      console.error('CIDR range compute error:', err);
      return success({ valid: false });
    }

    return success({
      valid: true,
      ...range,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('CIDR validate error:', error);
    return errors.internal();
  }
}
