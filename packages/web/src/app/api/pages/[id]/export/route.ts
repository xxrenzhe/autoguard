import { NextResponse } from 'next/server';
import { queryOne } from '@autoguard/shared';
import type { Page, Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { errors } from '@/lib/api-response';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';

type Params = { params: Promise<{ id: string }> };

// GET /api/pages/[id]/export - Export page as ZIP
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const pageId = parseInt(id, 10);

  // Get page with offer info
  const page = queryOne<Page & { subdomain: string; user_id: number }>(
    `SELECT p.*, o.subdomain, o.user_id
     FROM pages p
     JOIN offers o ON o.id = p.offer_id
     WHERE p.id = ? AND o.is_deleted = 0`,
    [pageId]
  );

  if (!page) {
    return errors.notFound('Page not found');
  }

  // Check ownership
  if (page.user_id !== user.userId && user.role !== 'admin') {
    return errors.forbidden('Access denied');
  }

  // Determine variant (a=money, b=safe)
  const variant = page.page_type === 'money' ? 'a' : 'b';
  const pagesDir = process.env.PAGES_DIR || '/data/pages';
  const pageDir = path.join(pagesDir, page.subdomain, variant);

  // Check if directory exists
  if (!fs.existsSync(pageDir)) {
    return errors.notFound('Page files not found');
  }

  // Create ZIP archive
  const archive = archiver('zip', { zlib: { level: 9 } });

  // Collect chunks
  const chunks: Buffer[] = [];

  return new Promise<NextResponse>((resolve) => {
    archive.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const response = new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${page.subdomain}-${variant}.zip"`,
          'Content-Length': buffer.length.toString(),
        },
      });
      resolve(response);
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      resolve(errors.internal('Failed to create ZIP archive'));
    });

    // Add directory to archive
    archive.directory(pageDir, false);
    archive.finalize();
  });
}
