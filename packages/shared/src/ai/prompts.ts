import { queryOne, execute, queryAll } from '../db/connection.js';

export interface PromptVersion {
  id: number;
  prompt_id: number;
  version: number;
  content: string;
  is_active: number;
  created_at: string;
  created_by: number | null;
}

export interface Prompt {
  id: number;
  name: string;
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// 内置默认 Prompts
const DEFAULT_PROMPTS: Record<string, string> = {
  'safe-page-review': `You are an expert content writer. Generate a product review article for the following product:

Product Name: {{product_name}}
Product URL: {{product_url}}
Competitors: {{competitors}}

Requirements:
1. Write in a professional, unbiased tone
2. Include pros and cons
3. Compare with competitors if provided
4. Include a recommendation section
5. Format in HTML with proper headings and paragraphs
6. Length: 800-1200 words

Generate the HTML content directly without any markdown formatting.`,

  'safe-page-tips': `You are an expert content writer. Generate a tips and tricks article for the following product:

Product Name: {{product_name}}
Product URL: {{product_url}}

Requirements:
1. Write 5-8 practical tips for using the product
2. Include step-by-step instructions where appropriate
3. Add helpful hints and best practices
4. Format in HTML with proper headings and lists
5. Length: 600-1000 words

Generate the HTML content directly without any markdown formatting.`,

  'safe-page-comparison': `You are an expert content writer. Generate a product comparison article:

Main Product: {{product_name}}
Competitors: {{competitors}}

Requirements:
1. Create a detailed comparison table
2. Analyze features, pricing, and value
3. Provide objective analysis for each product
4. Include a summary with recommendations for different use cases
5. Format in HTML with proper tables and sections
6. Length: 1000-1500 words

Generate the HTML content directly without any markdown formatting.`,
};

/**
 * 获取 Prompt (优先数据库，回退默认)
 */
export function getPrompt(name: string): string | null {
  // 先查数据库
  const prompt = queryOne<{ content: string }>(
    `SELECT pv.content FROM prompt_versions pv
     JOIN prompts p ON p.id = pv.prompt_id
     WHERE p.name = ? AND pv.is_active = 1`,
    [name]
  );

  if (prompt) {
    return prompt.content;
  }

  // 回退到默认
  return DEFAULT_PROMPTS[name] || null;
}

/**
 * 填充 Prompt 模板
 */
export function fillPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  return result;
}

/**
 * 获取所有 Prompts
 */
export function getAllPrompts(): Prompt[] {
  return queryAll<Prompt>('SELECT * FROM prompts ORDER BY category, name');
}

/**
 * 获取 Prompt 的所有版本
 */
export function getPromptVersions(promptId: number): PromptVersion[] {
  return queryAll<PromptVersion>(
    'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC',
    [promptId]
  );
}

/**
 * 激活指定版本
 */
export function activatePromptVersion(promptId: number, versionId: number): void {
  // 先取消所有激活
  execute(
    'UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = ?',
    [promptId]
  );

  // 激活指定版本
  execute(
    'UPDATE prompt_versions SET is_active = 1 WHERE id = ? AND prompt_id = ?',
    [versionId, promptId]
  );
}

/**
 * 创建新版本
 */
export function createPromptVersion(
  promptId: number,
  content: string,
  createdBy?: number
): number {
  // 获取当前最大版本号
  const maxVersion = queryOne<{ max_version: number }>(
    'SELECT MAX(version) as max_version FROM prompt_versions WHERE prompt_id = ?',
    [promptId]
  );

  const newVersion = (maxVersion?.max_version || 0) + 1;

  const result = execute(
    `INSERT INTO prompt_versions (prompt_id, version, content, is_active, created_by)
     VALUES (?, ?, ?, 0, ?)`,
    [promptId, newVersion, content, createdBy || null]
  );

  return result.lastInsertRowid as number;
}
