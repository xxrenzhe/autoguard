'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface BlacklistEntry {
  id: number;
  // Different value columns per type
  ip_address?: string;
  cidr?: string;
  asn?: string;
  isp_name?: string;
  pattern?: string;
  pattern_type?: string;
  country_code?: string;
  region_code?: string;
  block_type?: string;
  reason: string | null;
  source: string | null;
  expires_at: string | null;
  created_at: string;
}

type BlacklistType = 'ip' | 'ip_range' | 'ua' | 'isp' | 'geo';

const TYPE_LABELS: Record<BlacklistType, string> = {
  ip: 'IP Addresses',
  ip_range: 'IP Ranges (CIDR)',
  ua: 'User-Agent Patterns',
  isp: 'ISP/ASN',
  geo: 'Countries/Regions',
};

const TYPE_PLACEHOLDERS: Record<BlacklistType, string> = {
  ip: '192.168.1.1',
  ip_range: '192.168.0.0/24',
  ua: 'Googlebot|bingbot',
  isp: 'AS15169 or Google Cloud',
  geo: 'US or CN',
};

// Helper to get display value from entry based on type
function getEntryValue(entry: BlacklistEntry, type: BlacklistType): string {
  switch (type) {
    case 'ip':
      return entry.ip_address || '';
    case 'ip_range':
      return entry.cidr || '';
    case 'ua':
      return entry.pattern || '';
    case 'isp':
      return entry.asn ? `${entry.asn}${entry.isp_name ? ` (${entry.isp_name})` : ''}` : entry.isp_name || '';
    case 'geo':
      return entry.country_code ? `${entry.country_code}${entry.region_code ? `/${entry.region_code}` : ''}` : '';
    default:
      return '';
  }
}

export default function BlacklistPage() {
  const [activeType, setActiveType] = useState<BlacklistType>('ip');
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<BlacklistType, number>>({
    ip: 0,
    ip_range: 0,
    ua: 0,
    isp: 0,
    geo: 0,
  });

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);

  // Bulk add state
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkValues, setBulkValues] = useState('');
  const [bulkAdding, setBulkAdding] = useState(false);

  const limit = 50;

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: activeType,
        scope: 'user',
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) {
        params.set('search', search);
      }

      const response = await fetch(`/api/blacklist?${params}`);
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to fetch blacklist');
        return;
      }

      setEntries(data.data);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [activeType, page, search]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/blacklist/stats');
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to fetch blacklist stats');
        return;
      }

      const counts = data.data?.counts;
      const userCounts = data.data?.user_counts;
      const effectiveCounts = userCounts || counts;
      if (!effectiveCounts) return;

      setStats({
        ip: effectiveCounts.ip || 0,
        ip_range: effectiveCounts.ip_ranges || 0,
        ua: effectiveCounts.uas || 0,
        isp: effectiveCounts.isps || 0,
        geo: effectiveCounts.geos || 0,
      });
    } catch {
      toast.error('Network error');
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;

    setAdding(true);
    try {
      const response = await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeType,
          value: newValue.trim(),
          reason: newReason.trim() || null,
          source: 'manual',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to add entry');
        return;
      }

      toast.success(data.message || 'Entry added');
      setNewValue('');
      setNewReason('');
      setShowAddForm(false);
      fetchEntries();
      fetchStats();
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function handleBulkAdd(e: React.FormEvent) {
    e.preventDefault();
    const values = bulkValues
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (values.length === 0) {
      toast.error('Please enter at least one value');
      return;
    }

    setBulkAdding(true);
    try {
      const response = await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeType,
          entries: values.map((value) => ({
            value,
            source: 'manual_bulk',
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to add entries');
        return;
      }

      toast.success(data.message || `Added ${data.data?.added || 0} entries`);
      setBulkValues('');
      setShowBulkAdd(false);
      fetchEntries();
      fetchStats();
    } catch {
      toast.error('Network error');
    } finally {
      setBulkAdding(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Are you sure you want to remove this entry?')) return;

    try {
      const response = await fetch(
        `/api/blacklist?type=${activeType}&id=${id}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to remove entry');
        return;
      }

      toast.success('Entry removed');
      fetchEntries();
      fetchStats();
    } catch {
      toast.error('Network error');
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Blacklist Management</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowBulkAdd(true)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
          >
            Bulk Import
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Entry
          </button>
        </div>
      </div>

      {/* Type Tabs */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b">
          <nav className="flex -mb-px">
            {(Object.keys(TYPE_LABELS) as BlacklistType[]).map((type) => (
              <button
                key={type}
                onClick={() => {
                  setActiveType(type);
                  setPage(1);
                  setSearch('');
                }}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeType === type
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {TYPE_LABELS[type]}
                <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                  {stats[type]}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Search */}
        <div className="p-4 border-b">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={`Search ${TYPE_LABELS[activeType].toLowerCase()}...`}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <span className="text-sm text-gray-500">
              {total} entries
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-500">Loading...</div>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-gray-500 mb-2">No entries found</p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Add your first entry
                </button>
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Added
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Expires
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                        {getEntryValue(entry, activeType)}
                      </code>
                      {activeType === 'ua' && entry.pattern_type && (
                        <span className="ml-2 text-xs text-gray-400">({entry.pattern_type})</span>
                      )}
                      {activeType === 'geo' && entry.block_type && (
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                          entry.block_type === 'block' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {entry.block_type}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">
                        {entry.reason || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs bg-gray-100 rounded">
                        {entry.source || 'unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {entry.expires_at
                        ? new Date(entry.expires_at).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-red-600 hover:text-red-700 text-sm font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Add Entry Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Add to {TYPE_LABELS[activeType]}
            </h2>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Value *
                </label>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={TYPE_PLACEHOLDERS[activeType]}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  placeholder="e.g. Known bot network"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {adding ? 'Adding...' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Modal */}
      {showBulkAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Bulk Import to {TYPE_LABELS[activeType]}
            </h2>
            <form onSubmit={handleBulkAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Values (one per line)
                </label>
                <textarea
                  value={bulkValues}
                  onChange={(e) => setBulkValues(e.target.value)}
                  placeholder={`${TYPE_PLACEHOLDERS[activeType]}\n${TYPE_PLACEHOLDERS[activeType]}`}
                  rows={10}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                />
                <p className="mt-2 text-sm text-gray-500">
                  Enter one value per line. Up to 1000 entries at once.
                </p>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkAdd(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkAdding}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {bulkAdding ? 'Importing...' : 'Import All'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
