'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

type PageRow = {
  id: number;
  offerId: number;
  pageType: 'money' | 'safe';
  status: string;
  dbStatus?: string;
  variant: 'a' | 'b';
  brandName: string;
  subdomain: string;
  offerStatus: string;
  safePageType?: string | null;
  generationError?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PagesResponse = {
  data: PageRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function statusBadgeClass(status: string): string {
  if (status === 'ready') return 'bg-green-100 text-green-800';
  if (status === 'generating') return 'bg-yellow-100 text-yellow-800';
  if (status === 'failed' || status === 'error') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}

function pageTypeLabel(type: 'money' | 'safe'): string {
  return type === 'money' ? 'Money' : 'Safe';
}

export default function PagesPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [pageType, setPageType] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const [actionId, setActionId] = useState<number | null>(null);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (pageType) params.set('pageType', pageType);
      if (status) params.set('status', status);
      if (search) params.set('search', search);

      const response = await fetch(`/api/pages?${params.toString()}`, { cache: 'no-store' });
      const data = (await response.json()) as PagesResponse;
      if (!response.ok) {
        toast.error((data as unknown as { error?: { message?: string } }).error?.message || 'Failed to fetch pages');
        return;
      }

      setPages(data.data || []);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [page, pageType, status, search]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  const runRegenerate = async (id: number) => {
    setActionId(id);
    try {
      const res = await fetch(`/api/pages/${id}/regenerate`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error?.message || 'Regenerate failed');
        return;
      }
      toast.success(body.message || 'Regeneration queued');
      await fetchPages();
    } catch {
      toast.error('Network error');
    } finally {
      setActionId(null);
    }
  };

  const runDelete = async (id: number) => {
    if (!confirm('Delete this page? This will remove DB row and page files.')) return;
    setActionId(id);
    try {
      const res = await fetch(`/api/pages/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error?.message || 'Delete failed');
        return;
      }
      toast.success(body.message || 'Deleted');
      await fetchPages();
    } catch {
      toast.error('Network error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pages</h1>
        <Link href="/offers" className="text-blue-600 hover:text-blue-700 font-medium">
          Manage offers →
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={pageType}
              onChange={(e) => {
                setPageType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All</option>
              <option value="money">Money</option>
              <option value="safe">Safe</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All</option>
              <option value="ready">Ready</option>
              <option value="generating">Generating</option>
              <option value="failed">Failed</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearch(searchInput.trim());
                  setPage(1);
                }
              }}
              placeholder="Brand or subdomain..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={() => {
                setSearch(searchInput.trim());
                setPage(1);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Search
            </button>
            <button
              onClick={() => {
                setPageType('');
                setStatus('');
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading pages...</div>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-gray-500 mb-2">No pages found</p>
              <p className="text-sm text-gray-400">Create an offer and generate pages to see them here</p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pages.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.brandName}</div>
                        <div className="text-sm text-gray-500">
                          <a
                            href={`https://${p.subdomain}.autoguard.dev`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-700"
                          >
                            {p.subdomain}.autoguard.dev
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {pageTypeLabel(p.pageType)}
                        {p.pageType === 'safe' && p.safePageType ? (
                          <span className="text-gray-500"> · {p.safePageType}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusBadgeClass(p.status)}`}>
                          {p.status}
                        </span>
                        {p.status === 'failed' && p.generationError ? (
                          <div className="mt-1 text-xs text-red-700 max-w-[420px] truncate" title={p.generationError}>
                            {p.generationError}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                        {new Date(p.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`/api/pages/${p.id}/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                          >
                            Preview
                          </a>
                          <a
                            href={`/api/pages/${p.id}/export`}
                            className="px-3 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                          >
                            Export
                          </a>
                          <button
                            onClick={() => runRegenerate(p.id)}
                            disabled={actionId === p.id}
                            className="px-3 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {actionId === p.id ? 'Working...' : 'Regenerate'}
                          </button>
                          <button
                            onClick={() => runDelete(p.id)}
                            disabled={actionId === p.id}
                            className="px-3 py-1 border border-red-300 rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-gray-600">
                Total: {total} · Page {page} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

