import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: Required<Omit<GeminiConfig, 'apiKey'>> = {
  model: 'gemini-1.5-flash',
  maxOutputTokens: 8192,
  temperature: 0.7,
};

/**
 * 初始化 Gemini
 */
export function initGemini(config?: GeminiConfig): void {
  const apiKey = config?.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({
    model: config?.model || DEFAULT_CONFIG.model,
    generationConfig: {
      maxOutputTokens: config?.maxOutputTokens || DEFAULT_CONFIG.maxOutputTokens,
      temperature: config?.temperature || DEFAULT_CONFIG.temperature,
    },
  });
}

/**
 * 获取 Gemini 模型实例
 */
export function getModel(): GenerativeModel {
  if (!model) {
    initGemini();
  }
  return model!;
}

/**
 * 生成文本内容
 */
export async function generateText(prompt: string): Promise<string> {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

/**
 * 生成结构化内容 (JSON)
 */
export async function generateJSON<T>(prompt: string): Promise<T> {
  const model = getModel();

  const jsonPrompt = `${prompt}

IMPORTANT: Respond ONLY with valid JSON. Do not include any markdown formatting, code blocks, or explanatory text. Just pure JSON.`;

  const result = await model.generateContent(jsonPrompt);
  const response = await result.response;
  const text = response.text();

  // 尝试提取 JSON
  let jsonStr = text;

  // 移除可能的 markdown 代码块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    jsonStr = jsonMatch[1];
  }

  // 尝试解析
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    // 如果解析失败，尝试找到第一个 { 和最后一个 }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`Failed to parse JSON response: ${text.substring(0, 200)}`);
  }
}

/**
 * 流式生成文本
 */
export async function* generateTextStream(prompt: string): AsyncGenerator<string, void, unknown> {
  const model = getModel();
  const result = await model.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    if (chunkText) {
      yield chunkText;
    }
  }
}

/**
 * 计算 Token 数量 (估算)
 */
export function estimateTokenCount(text: string): number {
  // 粗略估算：中文约 1.5 字符/token，英文约 4 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
