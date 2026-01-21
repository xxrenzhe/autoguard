import { z } from 'zod';
import { isValidCIDR } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

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

function cidrToRange(cidr: string): { ip_start: string; ip_end: string; total_ips: number } {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr || '32', 10);

  const ipNum = ipToNumber(ip || '0.0.0.0');
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipNum & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const totalIps = Math.pow(2, 32 - prefix);

  return {
    ip_start: numberToIp(network),
    ip_end: numberToIp(broadcast),
    total_ips: totalIps,
  };
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

    const range = cidrToRange(cidr);

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

