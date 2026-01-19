/**
 * Cloak Worker
 * 处理所有入口流量，执行 Cloak 决策，使用 X-Accel-Redirect 无跳转返回页面
 */

import express, { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { makeDecision, initEngine, getDecisionReason } from '@autoguard/cloak';
import type { CloakDecision } from '@autoguard/cloak';
import { getRedis, CacheKeys, safeJsonParse } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';

const app = express();

// 禁用 X-Powered-By 头
app.disable('x-powered-by');

// 信任代理（Nginx/Cloudflare）
app.set('trust proxy', true);

// 健康检查
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 主入口处理
app.use('*', handleCloakRequest);

/**
 * 处理 Cloak 请求
 */
async function handleCloakRequest(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  try {
    // 1) 解析 Offer
    const offer = await resolveOffer(req);

    if (!offer || offer.status !== 'active' || offer.is_deleted === 1) {
      sendNotFound(res);
      return;
    }

    // 2) 提取请求信息
    const cloakRequest = {
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'] || '',
      referer: req.headers['referer'] || '',
      url: req.headers['x-original-uri']?.toString() || req.originalUrl,
      host: (req.headers.host || '').split(':')[0],
    };

    // 3) 决定变体（A=Money，B=Safe）
    let variant: 'a' | 'b' = 'b';

    if (offer.cloak_enabled !== 1) {
      // Cloak 关闭：强制 B (Safe)
      variant = 'b';
    } else {
      // 解析目标国家
      const targetCountries = offer.target_countries
        ? safeJsonParse<string[]>(offer.target_countries, [])
        : [];

      // 运行检测引擎
      const decision = await makeDecision(
        cloakRequest,
        offer.id,
        offer.user_id,
        {
          targetCountries,
          cloakEnabled: true,
        }
      );

      variant = decision.decision === 'money' ? 'a' : 'b';

      // 异步记录日志
      logCloakRequest(offer, cloakRequest, decision).catch((err) => {
        console.error('Failed to log cloak request:', err);
      });
    }

    // 4) 使用 X-Accel-Redirect 内部重定向（关键！无 302 跳转）
    const internalPath = `/internal/pages/${offer.subdomain}/${variant}/index.html`;

    res.setHeader('X-Accel-Redirect', internalPath);
    res.setHeader('X-Accel-Buffering', 'yes');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(200).end();
  } catch (error) {
    console.error('Cloak request error:', error);

    // 出错时尝试展示 Safe 页面
    const subdomain = extractSubdomain(req);
    if (subdomain) {
      res.setHeader('X-Accel-Redirect', `/internal/pages/${subdomain}/b/index.html`);
      res.setHeader('X-Accel-Buffering', 'yes');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end();
    } else {
      sendNotFound(res);
    }
  } finally {
    const processingTime = Date.now() - startTime;
    if (processingTime > 100) {
      console.warn(`Cloak decision took ${processingTime}ms`);
    }
  }
}

/**
 * 解析 Offer
 */
async function resolveOffer(req: Request): Promise<Offer | null> {
  const routeType = req.headers['x-route-type'];

  // 路径模式或子域名模式
  const subdomain = extractSubdomain(req);
  if (subdomain) {
    return getOfferBySubdomain(subdomain);
  }

  // 自定义域名模式
  const customDomain = req.headers['x-custom-domain'];
  if (typeof customDomain === 'string' && customDomain) {
    return getOfferByCustomDomain(customDomain.toLowerCase());
  }

  return null;
}

/**
 * 从请求中提取 subdomain
 */
function extractSubdomain(req: Request): string | null {
  // 优先从 Nginx 注入的 Header 获取
  const headerSubdomain = req.headers['x-subdomain'];
  if (typeof headerSubdomain === 'string' && headerSubdomain) {
    return headerSubdomain;
  }

  // 路径模式：/c/{subdomain}
  const pathMatch = req.originalUrl.match(/^\/c\/([a-z0-9]{6})(?:\/|$|\?)/);
  if (pathMatch) {
    return pathMatch[1]!;
  }

  return null;
}

/**
 * 通过子域名获取 Offer（带缓存）
 */
async function getOfferBySubdomain(subdomain: string): Promise<Offer | null> {
  const redis = getRedis();
  const cacheKey = CacheKeys.offer.bySubdomain(subdomain);

  // 检查缓存
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Offer;
  }

  // 从数据库查询
  const { queryOne } = await import('@autoguard/shared');
  const offer = queryOne<Offer>(
    `SELECT * FROM offers WHERE subdomain = ? AND is_deleted = 0`,
    [subdomain]
  );

  if (offer) {
    // 写入缓存（5 分钟）
    await redis.set(cacheKey, JSON.stringify(offer), 'EX', 300);
  }

  return offer ?? null;
}

/**
 * 通过自定义域名获取 Offer（带缓存）
 */
async function getOfferByCustomDomain(domain: string): Promise<Offer | null> {
  const redis = getRedis();
  const cacheKey = CacheKeys.offer.byDomain(domain);

  // 检查缓存
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Offer;
  }

  // 从数据库查询
  const { queryOne } = await import('@autoguard/shared');
  const offer = queryOne<Offer>(
    `SELECT * FROM offers
     WHERE custom_domain = ? AND custom_domain_status = 'verified' AND is_deleted = 0`,
    [domain]
  );

  if (offer) {
    await redis.set(cacheKey, JSON.stringify(offer), 'EX', 300);
  }

  return offer ?? null;
}

/**
 * 获取真实客户端 IP
 */
function getClientIP(req: Request): string {
  // 优先使用 Cloudflare 头
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIP === 'string' && cfConnectingIP) {
    return cfConnectingIP.trim();
  }

  // X-Forwarded-For（取第一个 IP）
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    return xForwardedFor.split(',')[0]!.trim();
  }

  // X-Real-IP
  const xRealIP = req.headers['x-real-ip'];
  if (typeof xRealIP === 'string') {
    return xRealIP;
  }

  // 直接连接
  return req.socket.remoteAddress || '';
}

/**
 * 发送 404 响应（不暴露系统信息）
 */
function sendNotFound(res: Response): void {
  res
    .status(404)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(
      '<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>404 Not Found</h1></body></html>'
    );
}

/**
 * 异步记录 Cloak 请求日志
 */
async function logCloakRequest(
  offer: Offer,
  request: { ip: string; userAgent: string; referer?: string; url: string },
  decision: CloakDecision
): Promise<void> {
  const redis = getRedis();

  const logEntry = {
    user_id: offer.user_id,
    offer_id: offer.id,
    ip_address: request.ip,
    user_agent: request.userAgent,
    referer: request.referer || null,
    request_url: request.url,
    decision: decision.decision,
    decision_reason: getDecisionReason(decision),
    fraud_score: decision.score,
    blocked_at_layer: decision.blockedAt || null,
    detection_details: JSON.stringify(decision.details),
    ip_country: decision.details.l3?.geoInfo?.country || null,
    ip_city: decision.details.l3?.geoInfo?.city || null,
    ip_isp: decision.details.l2?.ispInfo?.org || null,
    ip_asn: decision.details.l2?.ispInfo?.asn || null,
    is_datacenter: decision.details.l2?.isDatacenter ? 1 : 0,
    is_vpn: decision.details.l2?.isVPN ? 1 : 0,
    is_proxy: decision.details.l2?.isProxy ? 1 : 0,
    processing_time_ms: decision.processingTime,
    has_tracking_params: decision.details.l5?.hasTrackingParams ? 1 : 0,
    gclid: decision.details.l5?.trackingParams?.gclid || null,
    created_at: new Date().toISOString(),
  };

  // 推送到 Redis 队列，由 Log Writer 批量写入
  await redis.lpush(CacheKeys.queue.cloakLogs, JSON.stringify(logEntry));
}

// 初始化并启动服务器
async function start(): Promise<void> {
  // 初始化 Cloak 引擎
  await initEngine();

  const port = parseInt(process.env.CLOAK_WORKER_PORT || '3001', 10);

  app.listen(port, () => {
    console.log(`Cloak Worker running on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start Cloak Worker:', err);
  process.exit(1);
});
