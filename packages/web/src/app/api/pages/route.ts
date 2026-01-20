import { queryAll, queryOne } from '@autoguard/shared';
import type { Page, Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { list, errors } from '@/lib/api-response';

interface PageWithOffer extends Page {
  brand_name: string;
  subdomain: string;
  offer_status: string;
}

// GET /api/pages - Get all pages (global list)
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const pageType = searchParams.get('page_type'); // money | safe
  const status = searchParams.get('status'); // generating | ready | error
  const offerId = searchParams.get('offer_id');

  const offset = (page - 1) * limit;

  let sql = `
    SELECT p.*, o.brand_name, o.subdomain, o.status as offer_status
    FROM pages p
    JOIN offers o ON o.id = p.offer_id
    WHERE o.user_id = ? AND o.is_deleted = 0
  `;
  const params: unknown[] = [user.userId];

  if (pageType) {
    sql += ' AND p.page_type = ?';
    params.push(pageType);
  }

  if (status) {
    sql += ' AND p.status = ?';
    params.push(status);
  }

  if (offerId) {
    sql += ' AND p.offer_id = ?';
    params.push(parseInt(offerId, 10));
  }

  sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const pages = queryAll<PageWithOffer>(sql, params);

  // Get total count
  let countSql = `
    SELECT COUNT(*) as count
    FROM pages p
    JOIN offers o ON o.id = p.offer_id
    WHERE o.user_id = ? AND o.is_deleted = 0
  `;
  const countParams: unknown[] = [user.userId];

  if (pageType) {
    countSql += ' AND p.page_type = ?';
    countParams.push(pageType);
  }
  if (status) {
    countSql += ' AND p.status = ?';
    countParams.push(status);
  }
  if (offerId) {
    countSql += ' AND p.offer_id = ?';
    countParams.push(parseInt(offerId, 10));
  }

  const countResult = queryOne<{ count: number }>(countSql, countParams);
  const total = countResult?.count || 0;

  return list(pages, { page, limit, total });
}
