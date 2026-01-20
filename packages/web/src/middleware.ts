/**
 * Next.js Middleware
 * 路由保护 - 确保未登录用户无法访问 Dashboard
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

const COOKIE_NAME = 'autoguard-token';

// 需要登录才能访问的路径前缀
const PROTECTED_PATHS = ['/offers', '/logs', '/stats', '/blacklist', '/settings', '/admin'];

// 不需要登录的路径（登录页等）
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静态资源和 API 路由（除了需要保护的 API）不拦截
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // 静态文件
  ) {
    return NextResponse.next();
  }

  // API 路由需要特殊处理
  if (pathname.startsWith('/api/')) {
    // 登录 API 不需要验证
    if (pathname === '/api/auth/login') {
      return NextResponse.next();
    }

    // 其他 API 需要验证
    const token = request.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } },
        { status: 401 }
      );
    }

    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '登录已过期' } },
        { status: 401 }
      );
    }
  }

  // 检查是否是需要保护的页面路径
  const isProtectedPath = PROTECTED_PATHS.some(
    (path) => pathname.startsWith(path) || pathname === '/'
  );

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // 公开路径直接放行
  if (isPublicPath) {
    // 但如果已登录访问登录页，重定向到首页
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token && pathname === '/login') {
      try {
        await jwtVerify(token, JWT_SECRET);
        return NextResponse.redirect(new URL('/offers', request.url));
      } catch {
        // token 无效，继续显示登录页
      }
    }
    return NextResponse.next();
  }

  // 保护路径需要验证
  if (isProtectedPath) {
    const token = request.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      // token 无效，重定向到登录页
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete(COOKIE_NAME);
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径除了:
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
