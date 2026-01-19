'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';

interface Settings {
  ai: {
    gemini_api_key?: string;
    gemini_model?: string;
  };
  proxy: {
    proxy_url?: string;
    proxy_enabled?: boolean;
  };
  cloak: {
    decision_timeout_ms?: number;
    safe_mode_threshold?: number;
    enable_ip_check?: boolean;
    enable_ua_check?: boolean;
    enable_geo_check?: boolean;
    enable_referer_check?: boolean;
  };
  system: {
    log_retention_days?: number;
    max_pages_per_offer?: number;
  };
}

const DEFAULT_SETTINGS: Settings = {
  ai: {
    gemini_model: 'gemini-1.5-flash',
  },
  proxy: {
    proxy_enabled: false,
  },
  cloak: {
    decision_timeout_ms: 100,
    safe_mode_threshold: 50,
    enable_ip_check: true,
    enable_ua_check: true,
    enable_geo_check: true,
    enable_referer_check: true,
  },
  system: {
    log_retention_days: 30,
    max_pages_per_offer: 10,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'ai' | 'cloak' | 'proxy' | 'system'>('ai');

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      if (data.success) {
        setSettings({
          ...DEFAULT_SETTINGS,
          ...data.data,
          ai: { ...DEFAULT_SETTINGS.ai, ...data.data.ai },
          proxy: { ...DEFAULT_SETTINGS.proxy, ...data.data.proxy },
          cloak: { ...DEFAULT_SETTINGS.cloak, ...data.data.cloak },
          system: { ...DEFAULT_SETTINGS.system, ...data.data.system },
        });
      }
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(
    category: keyof Settings,
    key: string,
    value: unknown,
    options?: { isSensitive?: boolean; dataType?: string }
  ) {
    setSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, key, value, options }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Setting saved');
      } else {
        toast.error(data.error?.message || 'Failed to save setting');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  function updateLocalSetting<K extends keyof Settings>(
    category: K,
    key: keyof Settings[K],
    value: Settings[K][keyof Settings[K]]
  ) {
    setSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your AutoGuard system</p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b">
          <nav className="flex -mb-px">
            {(['ai', 'cloak', 'proxy', 'system'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab === 'ai' ? 'AI / Gemini' : tab === 'cloak' ? 'Cloak' : tab === 'proxy' ? 'Proxy' : 'System'}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* AI Settings */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gemini API Key
                </label>
                <div className="flex space-x-3">
                  <input
                    type="password"
                    value={settings.ai.gemini_api_key || ''}
                    onChange={(e) => updateLocalSetting('ai', 'gemini_api_key', e.target.value)}
                    placeholder="Enter your Gemini API key"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => saveSetting('ai', 'gemini_api_key', settings.ai.gemini_api_key, { isSensitive: true })}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Get your API key from{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    Google AI Studio
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gemini Model
                </label>
                <div className="flex space-x-3">
                  <select
                    value={settings.ai.gemini_model || 'gemini-1.5-flash'}
                    onChange={(e) => updateLocalSetting('ai', 'gemini_model', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (Recommended)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                    <option value="gemini-pro">Gemini Pro</option>
                  </select>
                  <button
                    onClick={() => saveSetting('ai', 'gemini_model', settings.ai.gemini_model)}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cloak Settings */}
          {activeTab === 'cloak' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Decision Timeout (ms)
                </label>
                <div className="flex space-x-3">
                  <input
                    type="number"
                    value={settings.cloak.decision_timeout_ms || 100}
                    onChange={(e) => updateLocalSetting('cloak', 'decision_timeout_ms', parseInt(e.target.value))}
                    min={10}
                    max={1000}
                    className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => saveSetting('cloak', 'decision_timeout_ms', settings.cloak.decision_timeout_ms, { dataType: 'number' })}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Maximum time to wait for cloak decision before defaulting to safe page
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Safe Mode Threshold (%)
                </label>
                <div className="flex space-x-3">
                  <input
                    type="number"
                    value={settings.cloak.safe_mode_threshold || 50}
                    onChange={(e) => updateLocalSetting('cloak', 'safe_mode_threshold', parseInt(e.target.value))}
                    min={0}
                    max={100}
                    className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => saveSetting('cloak', 'safe_mode_threshold', settings.cloak.safe_mode_threshold, { dataType: 'number' })}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Risk score threshold above which traffic is shown safe page
                </p>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-4">Detection Layers</h3>
                <div className="space-y-4">
                  {[
                    { key: 'enable_ip_check', label: 'IP Blacklist Check', description: 'Block known bad IPs and datacenter ranges' },
                    { key: 'enable_ua_check', label: 'User-Agent Check', description: 'Detect bot user agents and crawlers' },
                    { key: 'enable_geo_check', label: 'Geo Check', description: 'Filter by country/region restrictions' },
                    { key: 'enable_referer_check', label: 'Referer Check', description: 'Validate traffic sources' },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div>
                        <h4 className="font-medium text-gray-900">{item.label}</h4>
                        <p className="text-sm text-gray-500">{item.description}</p>
                      </div>
                      <button
                        onClick={() => {
                          const newValue = !settings.cloak[item.key as keyof typeof settings.cloak];
                          updateLocalSetting('cloak', item.key as keyof typeof settings.cloak, newValue);
                          saveSetting('cloak', item.key, newValue, { dataType: 'boolean' });
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.cloak[item.key as keyof typeof settings.cloak] ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.cloak[item.key as keyof typeof settings.cloak] ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Proxy Settings */}
          {activeTab === 'proxy' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900">Enable Proxy</h4>
                  <p className="text-sm text-gray-500">Route requests through a proxy server</p>
                </div>
                <button
                  onClick={() => {
                    const newValue = !settings.proxy.proxy_enabled;
                    updateLocalSetting('proxy', 'proxy_enabled', newValue);
                    saveSetting('proxy', 'proxy_enabled', newValue, { dataType: 'boolean' });
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.proxy.proxy_enabled ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.proxy.proxy_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {settings.proxy.proxy_enabled && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proxy URL
                  </label>
                  <div className="flex space-x-3">
                    <input
                      type="text"
                      value={settings.proxy.proxy_url || ''}
                      onChange={(e) => updateLocalSetting('proxy', 'proxy_url', e.target.value)}
                      placeholder="http://user:pass@proxy.example.com:8080"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    />
                    <button
                      onClick={() => saveSetting('proxy', 'proxy_url', settings.proxy.proxy_url, { isSensitive: true })}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    Supports HTTP and SOCKS5 proxies
                  </p>
                </div>
              )}
            </div>
          )}

          {/* System Settings */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Log Retention (days)
                </label>
                <div className="flex space-x-3">
                  <input
                    type="number"
                    value={settings.system.log_retention_days || 30}
                    onChange={(e) => updateLocalSetting('system', 'log_retention_days', parseInt(e.target.value))}
                    min={1}
                    max={365}
                    className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => saveSetting('system', 'log_retention_days', settings.system.log_retention_days, { dataType: 'number' })}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Number of days to keep cloak logs before automatic cleanup
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Pages Per Offer
                </label>
                <div className="flex space-x-3">
                  <input
                    type="number"
                    value={settings.system.max_pages_per_offer || 10}
                    onChange={(e) => updateLocalSetting('system', 'max_pages_per_offer', parseInt(e.target.value))}
                    min={1}
                    max={50}
                    className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => saveSetting('system', 'max_pages_per_offer', settings.system.max_pages_per_offer, { dataType: 'number' })}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Maximum number of scraped pages allowed per offer
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
