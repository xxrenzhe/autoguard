'use client';

import { useState, useEffect } from 'react';

interface Prompt {
  id: number;
  name: string;
  category: string;
  description: string | null;
  isActive?: boolean;
  activeVersion?: { id: number; version: string; usageCount: number; successRate: number | null } | null;
}

interface PromptVersion {
  id: number;
  promptId: number;
  version: number;
  content: string;
  isActive: number;
  status: string;
  createdAt: string;
  activatedAt: string | null;
}

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrompts();
  }, []);

  async function fetchPrompts() {
    try {
      const res = await fetch('/api/admin/prompts');
      if (!res.ok) throw new Error('Failed to fetch prompts');
      const data = await res.json();
      setPrompts(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchVersions(promptId: number) {
    try {
      const res = await fetch(`/api/admin/prompts/${promptId}/versions`);
      if (!res.ok) throw new Error('Failed to fetch versions');
      const data = await res.json();
      setVersions(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function activateVersion(promptId: number, versionId: number) {
    try {
      const res = await fetch(`/api/admin/prompts/${promptId}/activate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) throw new Error('Failed to activate version');

      // Refresh data
      await fetchVersions(promptId);
      await fetchPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleSelectPrompt(prompt: Prompt) {
    setSelectedPrompt(prompt);
    fetchVersions(prompt.id);
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">Loading prompts...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Prompt 管理</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            关闭
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prompts List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b">
              <h2 className="font-semibold">Prompts ({prompts.length})</h2>
            </div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => handleSelectPrompt(prompt)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                    selectedPrompt?.id === prompt.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="font-medium text-sm">{prompt.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{prompt.category}</div>
                  {prompt.description && (
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {prompt.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Versions Panel */}
        <div className="lg:col-span-2">
          {selectedPrompt ? (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b">
                <h2 className="font-semibold">{selectedPrompt.name} - 版本历史</h2>
                <p className="text-sm text-gray-500 mt-1">{selectedPrompt.description}</p>
              </div>
              <div className="divide-y">
                {versions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500">
                    暂无版本记录
                  </div>
                ) : (
                  versions.map((version) => (
                    <div key={version.id} className="px-4 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Version {version.version}</span>
                          {version.isActive === 1 ? (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                              {version.status}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {new Date(version.createdAt).toLocaleDateString()}
                          </span>
                          {version.isActive !== 1 && (
                            <button
                              onClick={() => activateVersion(selectedPrompt.id, version.id)}
                              className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                            >
                              激活
                            </button>
                          )}
                        </div>
                      </div>
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto">
                        {version.content}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow px-4 py-12 text-center text-gray-500">
              请从左侧选择一个 Prompt 查看版本历史
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
