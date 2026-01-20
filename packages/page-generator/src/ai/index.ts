/**
 * AI 内容生成器
 * 使用 Google Gemini 生成 Safe Page 内容
 * 支持从数据库加载 Prompt 版本
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Safe Page 类型
 */
export type SafePageType = 'review' | 'tips' | 'comparison' | 'guide';

/**
 * 生成配置
 */
export interface GenerateConfig {
  brandName: string;
  brandUrl: string;
  brandDescription?: string;
  pageType: SafePageType;
  competitors?: string[];
  targetKeywords?: string[];
  language?: string;
  tone?: 'professional' | 'casual' | 'friendly';
  affiliateLink?: string; // CTA 链接
  apiKey?: string;
  model?: string;
}

/**
 * 生成结果
 */
export interface GenerateResult {
  success: boolean;
  html?: string;
  title?: string;
  content?: string;
  promptVersion?: number;
  error?: string;
}

/**
 * 获取 Prompt 内容（优先从数据库，回退到默认）
 */
async function getPromptContent(pageType: SafePageType): Promise<{ content: string; version?: number }> {
  // Use underscore naming to match seed.ts: safe_page_review, safe_page_tips, etc.
  const promptName = `safe_page_${pageType}`;

  try {
    // 尝试从数据库获取激活的 Prompt 版本
    const { getPrompt } = await import('@autoguard/shared');
    const dbPrompt = getPrompt(promptName);
    if (dbPrompt) {
      return { content: dbPrompt, version: 1 };
    }
  } catch {
    // 数据库不可用，使用默认
  }

  // 返回默认 Prompt
  return { content: getDefaultPrompt(pageType) };
}

/**
 * 获取默认 Prompt
 */
function getDefaultPrompt(pageType: SafePageType): string {
  const prompts: Record<SafePageType, string> = {
    review: `Write a comprehensive product review article about {{product_name}} ({{product_url}}).
{{#description}}Product description: {{description}}{{/description}}

The review should:
- Be objective and balanced
- Highlight key features and benefits
- Discuss potential drawbacks honestly
- Include a final recommendation
- Be at least 800 words

{{#cta_link}}Include a call-to-action button linking to: {{cta_link}}{{/cta_link}}`,

    comparison: `Write a detailed comparison article between {{product_name}} and {{competitors}}.
{{#description}}{{product_name}} description: {{description}}{{/description}}

The comparison should:
- Compare features, pricing, and use cases
- Be fair and objective
- Help readers make an informed decision
- Include a comparison table
- Be at least 1000 words

{{#cta_link}}Include a call-to-action for {{product_name}} linking to: {{cta_link}}{{/cta_link}}`,

    tips: `Write an educational tips article about how to best use {{product_name}} ({{product_url}}).
{{#description}}Product description: {{description}}{{/description}}

The article should:
- Include 7-10 practical tips
- Explain each tip clearly with examples
- Help users get the most value
- Be beginner-friendly
- Be at least 800 words

{{#cta_link}}Include a call-to-action linking to: {{cta_link}}{{/cta_link}}`,

    guide: `Write a comprehensive beginner's guide for {{product_name}} ({{product_url}}).
{{#description}}Product description: {{description}}{{/description}}

The guide should:
- Explain what the product is and who it's for
- Cover getting started steps
- Include best practices
- Address common questions
- Be at least 1000 words

{{#cta_link}}Include a call-to-action linking to: {{cta_link}}{{/cta_link}}`,
  };

  return prompts[pageType] || prompts.review;
}

/**
 * 生成 Safe Page 内容
 */
export async function generateSafePage(config: GenerateConfig): Promise<GenerateResult> {
  const {
    brandName,
    brandUrl,
    brandDescription,
    pageType,
    competitors = [],
    targetKeywords = [],
    language = 'en',
    tone = 'professional',
    affiliateLink,
    apiKey: apiKeyOverride,
    model: modelOverride,
  } = config;

  try {
    const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        success: false,
        error: 'Gemini API key is not configured',
      };
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = modelOverride ?? process.env.GEMINI_MODEL ?? 'gemini-1.5-pro';
    const model = genAI.getGenerativeModel({ model: modelName });

    // 获取 Prompt（优先数据库版本）
    const { content: promptTemplate, version: promptVersion } = await getPromptContent(pageType);

    const prompt = buildPrompt(promptTemplate, {
      brandName,
      brandUrl,
      brandDescription,
      pageType,
      competitors,
      targetKeywords,
      language,
      tone,
      affiliateLink,
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 解析生成的内容
    const { title, content, html } = parseGeneratedContent(text, brandName, affiliateLink);

    return {
      success: true,
      html,
      title,
      content,
      promptVersion,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 构建提示词
 */
function buildPrompt(
  template: string,
  config: {
    brandName: string;
    brandUrl: string;
    brandDescription?: string;
    pageType: SafePageType;
    competitors: string[];
    targetKeywords: string[];
    language: string;
    tone: string;
    affiliateLink?: string;
  }
): string {
  const {
    brandName,
    brandUrl,
    brandDescription,
    pageType,
    competitors,
    targetKeywords,
    language,
    tone,
    affiliateLink,
  } = config;

  const languageLabel = language === 'en' ? 'English' : language;
  const competitorsText = competitors.length > 0 ? competitors.join(', ') : 'similar products';
  const ctaLink = affiliateLink || '';
  const ctaButton = affiliateLink
    ? `<a href="${affiliateLink}" class="cta-button" data-tracking target="_blank" rel="noopener noreferrer">Visit ${brandName}</a>`
    : '';

  // Replace template variables (support both SystemDesign2 placeholders and internal defaults)
  let prompt = template;

  // Handle conditional sections
  if (brandDescription) {
    prompt = prompt.replace(/\{\{#description\}\}(.*?)\{\{\/description\}\}/gs, '$1');
  } else {
    prompt = prompt.replace(/\{\{#description\}\}.*?\{\{\/description\}\}/gs, '');
  }

  if (affiliateLink) {
    prompt = prompt.replace(/\{\{#cta_link\}\}(.*?)\{\{\/cta_link\}\}/gs, '$1');
  } else {
    prompt = prompt.replace(/\{\{#cta_link\}\}.*?\{\{\/cta_link\}\}/gs, '');
  }

  // Fill placeholders
  const replacements: Record<string, string> = {
    // Default prompt placeholders
    product_name: brandName,
    product_url: brandUrl,
    description: brandDescription || '',
    competitors: competitorsText,
    cta_link: ctaLink,

    // SystemDesign2 placeholders
    brand_name: brandName,
    brand_url: brandUrl,
    brand_description: brandDescription || '',
    affiliate_link: ctaLink,
    target_language: languageLabel,
    page_type: pageType,
  };

  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  // Replace CTA button placeholder used in seeded prompts
  prompt = prompt.replace(/\[CTA_BUTTON\]/g, ctaButton);

  const keywordsSection =
    targetKeywords.length > 0
      ? `\n\nNaturally incorporate these keywords: ${targetKeywords.join(', ')}`
      : '';

  return `${prompt}
${keywordsSection}

Language: ${languageLabel}
Tone: ${tone}

Format the output as HTML with proper headings (h1, h2, h3), paragraphs, and lists.
Include a clear, SEO-friendly title in an h1 tag.
Make the content informative and genuinely helpful to readers.

Output ONLY the HTML content, starting with <article> and ending with </article>.`;
}

/**
 * 解析生成的内容
 */
function parseGeneratedContent(
  text: string,
  brandName: string,
  affiliateLink?: string
): { title: string; content: string; html: string } {
  // 提取 article 标签内容
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const articleContent = articleMatch ? articleMatch[1] : text;

  // 提取标题
  const titleMatch = articleContent?.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const title = titleMatch
    ? titleMatch[1]!.replace(/<[^>]+>/g, '')
    : `${brandName} Review`;

  // 构建完整 HTML
  const html = buildFullHtml(title, articleContent || text, affiliateLink);

  return {
    title,
    content: articleContent || text,
    html,
  };
}

/**
 * 构建完整 HTML 页面
 */
function buildFullHtml(title: string, content: string, affiliateLink?: string): string {
  // 如果有 affiliate link，添加 CTA 按钮样式
  const ctaStyle = affiliateLink ? `
    .cta-button {
      display: inline-block;
      background: #3b82f6;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin: 1.5rem 0;
      transition: background 0.2s;
    }
    .cta-button:hover {
      background: #2563eb;
      text-decoration: none;
    }` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(title)}">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.7;
      color: #333;
      background: #f9fafb;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fff;
      min-height: 100vh;
    }
    article {
      padding: 20px 0;
    }
    h1 {
      font-size: 2.2rem;
      color: #1a1a1a;
      margin-bottom: 1.5rem;
      line-height: 1.3;
    }
    h2 {
      font-size: 1.6rem;
      color: #2a2a2a;
      margin: 2rem 0 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #e5e7eb;
    }
    h3 {
      font-size: 1.3rem;
      color: #3a3a3a;
      margin: 1.5rem 0 0.75rem;
    }
    p {
      margin-bottom: 1rem;
      color: #4a4a4a;
    }
    ul, ol {
      margin: 1rem 0 1rem 2rem;
    }
    li {
      margin-bottom: 0.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border: 1px solid #e5e7eb;
    }
    th {
      background: #f3f4f6;
      font-weight: 600;
    }
    blockquote {
      border-left: 4px solid #3b82f6;
      padding-left: 1rem;
      margin: 1.5rem 0;
      font-style: italic;
      color: #666;
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .meta {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }${ctaStyle}
    @media (max-width: 640px) {
      h1 { font-size: 1.8rem; }
      h2 { font-size: 1.4rem; }
      .container { padding: 20px 15px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <article>
      ${content}
    </article>
  </div>
</body>
</html>`;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
