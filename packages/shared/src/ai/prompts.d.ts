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
/**
 * 获取 Prompt (优先数据库，回退默认)
 */
export declare function getPrompt(name: string): string | null;
/**
 * 填充 Prompt 模板
 */
export declare function fillPromptTemplate(template: string, variables: Record<string, string>): string;
/**
 * 获取所有 Prompts
 */
export declare function getAllPrompts(): Prompt[];
/**
 * 获取 Prompt 的所有版本
 */
export declare function getPromptVersions(promptId: number): PromptVersion[];
/**
 * 激活指定版本
 */
export declare function activatePromptVersion(promptId: number, versionId: number): void;
/**
 * 创建新版本
 */
export declare function createPromptVersion(promptId: number, content: string, createdBy?: number): number;
//# sourceMappingURL=prompts.d.ts.map