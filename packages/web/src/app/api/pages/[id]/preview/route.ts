import { queryOne } from '@autoguard/shared';
import type { Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { errors } from '@/lib/api-response';
import fs from 'fs';
import path from 'path';

type PageWithOffer = Page & { subdomain: string; user_id: number };

type Params = { params: Promise<{ id: string }> };

// GET /api/pages/[id]/preview - Preview page HTML
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const pageId = parseInt(id, 10);
  if (Number.isNaN(pageId)) {
    return errors.validation('Invalid page id');
  }

  const page = queryOne<PageWithOffer>(
    `SELECT p.*, o.subdomain, o.user_id
     FROM pages p
     JOIN offers o ON o.id = p.offer_id
     WHERE p.id = ? AND o.is_deleted = 0`,
    [pageId]
  );

  if (!page) {
    return errors.notFound('Page not found');
  }

  if (page.user_id !== user.userId && user.role !== 'admin') {
    return errors.forbidden('Access denied');
  }

  const variant = page.page_type === 'money' ? 'a' : 'b';
  const pagesDir = process.env.PAGES_DIR || '/data/pages';
  const filePath = path.join(pagesDir, page.subdomain, variant, 'index.html');

  let html: string | null = null;

  try {
    if (fs.existsSync(filePath)) {
      html = fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error('Failed to read preview file:', err);
  }

  if (!html && page.html_content) {
    html = page.html_content;
  }

  if (!html) {
    return errors.notFound('Page content not found');
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

