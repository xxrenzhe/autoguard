import { queryOne, execute } from '@autoguard/shared';
import type { Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';
import fs from 'fs';
import path from 'path';

type PageWithOffer = Page & {
  subdomain: string;
  brand_name: string;
  user_id: number;
  offer_status: string;
};

type Params = { params: Promise<{ id: string }> };

// GET /api/pages/[id] - Get page detail (SystemDesign2)
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
    `SELECT p.*, o.subdomain, o.brand_name, o.user_id, o.status as offer_status
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
  const filePath = `${page.subdomain}/${variant}/`;

  return success({
    id: page.id,
    offer_id: page.offer_id,
    page_type: page.page_type,
    safe_page_type: page.safe_page_type,
    status: page.status,
    content_source: page.content_source,
    generation_error: page.generation_error,
    generation_params: page.generation_params ? JSON.parse(page.generation_params) : null,
    competitors: page.competitors ? JSON.parse(page.competitors) : null,
    file_path: filePath,
    pages_dir: pagesDir,
    offer: {
      id: page.offer_id,
      subdomain: page.subdomain,
      brand_name: page.brand_name,
      status: page.offer_status,
    },
    created_at: page.created_at,
    updated_at: page.updated_at,
    published_at: page.published_at,
  });
}

// DELETE /api/pages/[id] - Delete page
export async function DELETE(request: Request, { params }: Params) {
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
    `SELECT p.*, o.subdomain, o.brand_name, o.user_id, o.status as offer_status
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

  // Delete DB record first
  execute('DELETE FROM pages WHERE id = ?', [pageId]);

  // Best-effort delete files
  try {
    const variant = page.page_type === 'money' ? 'a' : 'b';
    const pagesDir = process.env.PAGES_DIR || '/data/pages';
    const dirToRemove = path.join(pagesDir, page.subdomain, variant);
    if (dirToRemove.startsWith(pagesDir)) {
      fs.rmSync(dirToRemove, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Failed to delete page files:', err);
  }

  return success({ id: pageId, deleted: true }, 'Page deleted');
}
