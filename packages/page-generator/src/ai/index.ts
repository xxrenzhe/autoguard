/**
 * AI 内容生成器
 * 使用 Google Gemini 生成 Safe Page 内容
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// 初始化 Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
}

/**
 * 生成结果
 */
export interface GenerateResult {
  success: boolean;
  html?: string;
  title?: string;
  content?: string;
  error?: string;
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
  } = config;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const prompt = buildPrompt({
      brandName,
      brandUrl,
      brandDescription,
      pageType,
      competitors,
      targetKeywords,
      language,
      tone,
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 解析生成的内容
    const { title, content, html } = parseGeneratedContent(text, brandName);

    return {
      success: true,
      html,
      title,
      content,
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
function buildPrompt(config: {
  brandName: string;
  brandUrl: string;
  brandDescription?: string;
  pageType: SafePageType;
  competitors: string[];
  targetKeywords: string[];
  language: string;
  tone: string;
}): string {
  const {
    brandName,
    brandUrl,
    brandDescription,
    pageType,
    competitors,
    targetKeywords,
    language,
    tone,
  } = config;

  let basePrompt = '';

  switch (pageType) {
    case 'review':
      basePrompt = `Write a comprehensive product review article about ${brandName} (${brandUrl}).
${brandDescription ? `Product description: ${brandDescription}` : ''}

The review should:
- Be objective and balanced
- Highlight key features and benefits
- Discuss potential drawbacks honestly
- Include a final recommendation
- Be at least 800 words`;
      break;

    case 'comparison':
      const competitorList = competitors.length > 0 ? competitors.join(', ') : 'similar products';
      basePrompt = `Write a detailed comparison article between ${brandName} and ${competitorList}.
${brandDescription ? `${brandName} description: ${brandDescription}` : ''}

The comparison should:
- Compare features, pricing, and use cases
- Be fair and objective
- Help readers make an informed decision
- Include a comparison table
- Be at least 1000 words`;
      break;

    case 'tips':
      basePrompt = `Write an educational tips article about how to best use ${brandName} (${brandUrl}).
${brandDescription ? `Product description: ${brandDescription}` : ''}

The article should:
- Include 7-10 practical tips
- Explain each tip clearly with examples
- Help users get the most value
- Be beginner-friendly
- Be at least 800 words`;
      break;

    case 'guide':
      basePrompt = `Write a comprehensive beginner's guide for ${brandName} (${brandUrl}).
${brandDescription ? `Product description: ${brandDescription}` : ''}

The guide should:
- Explain what the product is and who it's for
- Cover getting started steps
- Include best practices
- Address common questions
- Be at least 1000 words`;
      break;
  }

  const keywordsSection =
    targetKeywords.length > 0
      ? `\n\nNaturally incorporate these keywords: ${targetKeywords.join(', ')}`
      : '';

  return `${basePrompt}
${keywordsSection}

Language: ${language === 'en' ? 'English' : language}
Tone: ${tone}

Format the output as HTML with proper headings (h1, h2, h3), paragraphs, and lists.
Include a clear, SEO-friendly title in an h1 tag.
Do not include any promotional or affiliate links in the content.
Make the content informative and genuinely helpful to readers.

Output ONLY the HTML content, starting with <article> and ending with </article>.`;
}

/**
 * 解析生成的内容
 */
function parseGeneratedContent(
  text: string,
  brandName: string
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
  const html = buildFullHtml(title, articleContent || text);

  return {
    title,
    content: articleContent || text,
    html,
  };
}

/**
 * 构建完整 HTML 页面
 */
function buildFullHtml(title: string, content: string): string {
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
    }
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
