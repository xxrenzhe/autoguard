import * as cheerio from 'cheerio';

/**
 * 重写所有链接为推广链接，并在运行时透传常见 tracking 参数（gclid/utm 等）
 */
export function rewriteLinks(html: string, affiliateLink: string): string {
  const $ = cheerio.load(html);

  // 重写所有 <a> 标签
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');

    // 跳过锚点链接
    if (!href || href.startsWith('#')) return;

    // 跳过 mailto 和 tel
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

    // 跳过已经是本地资源的链接
    if (href.startsWith('assets/') || href.startsWith('./assets/')) return;

    // 替换为推广链接
    $el.attr('href', affiliateLink);
    $el.attr('target', '_blank');
    $el.attr('rel', 'noopener noreferrer');
    $el.attr('data-track', 'cta-click');
    $el.attr('data-affiliate-url', affiliateLink);
  });

  // 重写所有按钮的点击事件（由注入脚本处理）
  $('button').each((_, el) => {
    const $el = $(el);
    $el.removeAttr('onclick');
    $el.attr('data-track', 'cta-click');
    $el.attr('data-affiliate-url', affiliateLink);
  });

  // 重写表单提交
  $('form').each((_, el) => {
    const $el = $(el);
    $el.attr('action', affiliateLink);
    $el.attr('method', 'GET');
    $el.attr('target', '_blank');
    $el.attr('data-affiliate-url', affiliateLink);
  });

  // 添加 tracking 参数透传 + 点击追踪脚本
  const trackingScript = `
<script>
(function() {
  // 1) 透传常见 tracking 参数到推广链接
  var allow = [
    'gclid','fbclid','msclkid','ttclid','twclid',
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'ref','affiliate_id','click_id'
  ];

  var srcParams = new URLSearchParams(window.location.search || '');
  var trackingParams = new URLSearchParams();
  if (srcParams.toString()) {
    allow.forEach(function(key) {
      var value = srcParams.get(key);
      if (value) trackingParams.set(key, value);
    });
  }
  var trackingQuery = trackingParams.toString();

  function withTracking(url) {
    if (!trackingQuery) return url;
    try {
      var u = new URL(url, window.location.origin);
      trackingParams.forEach(function(v, k) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      });
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  document.querySelectorAll('[data-affiliate-url]').forEach(function(el) {
    var baseUrl = el.getAttribute('data-affiliate-url') || '';
    if (!baseUrl) return;

    var finalUrl = withTracking(baseUrl);
    var tag = (el.tagName || '').toUpperCase();

    if (tag === 'A') {
      el.setAttribute('href', finalUrl);
    } else if (tag === 'FORM') {
      el.setAttribute('action', finalUrl);
    } else if (tag === 'BUTTON') {
      el.addEventListener('click', function(ev) {
        ev.preventDefault();
        window.open(finalUrl, '_blank');
      });
    }
  });

  // 2) 点击追踪（可扩展对接埋点）
  document.querySelectorAll('[data-track="cta-click"]').forEach(function(el) {
    el.addEventListener('click', function() {
      console.log('CTA Click:', el.tagName, (el.textContent || '').substring(0, 50));
    });
  });
})();
</script>
`;

  const htmlContent = $.html();
  const bodyCloseIndex = htmlContent.toLowerCase().lastIndexOf('</body>');
  if (bodyCloseIndex !== -1) {
    return (
      htmlContent.slice(0, bodyCloseIndex) +
      trackingScript +
      htmlContent.slice(bodyCloseIndex)
    );
  }

  return htmlContent + trackingScript;
}

