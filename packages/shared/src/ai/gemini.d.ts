import { GenerativeModel } from '@google/generative-ai';
export interface GeminiConfig {
    apiKey?: string;
    model?: string;
    maxOutputTokens?: number;
    temperature?: number;
}
/**
 * 初始化 Gemini
 */
export declare function initGemini(config?: GeminiConfig): void;
/**
 * 获取 Gemini 模型实例
 */
export declare function getModel(): GenerativeModel;
/**
 * 生成文本内容
 */
export declare function generateText(prompt: string): Promise<string>;
/**
 * 生成结构化内容 (JSON)
 */
export declare function generateJSON<T>(prompt: string): Promise<T>;
/**
 * 流式生成文本
 */
export declare function generateTextStream(prompt: string): AsyncGenerator<string, void, unknown>;
/**
 * 计算 Token 数量 (估算)
 */
export declare function estimateTokenCount(text: string): number;
//# sourceMappingURL=gemini.d.ts.map