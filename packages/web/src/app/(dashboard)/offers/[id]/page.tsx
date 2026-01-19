'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface OfferDetail {
  id: number;
  brand_name: string;
  brand_url: string;
  affiliate_link: string;
  subdomain: string;
  custom_domain: string | null;
  custom_domain_status: string | null;
  custom_domain_verified_at: string | null;
  target_countries: string[];
  cloak_enabled: number;
  status: string;
  created_at: string;
  updated_at: string;
  access_urls: {
    system: string;
    custom: string | null;
  };
}

export default function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchOffer();
  }, [id]);

  async function fetchOffer() {
    try {
      const response = await fetch(`/api/offers/${id}`);
      const data = await response.json();
      if (data.success) {
        setOffer(data.data);
      } else {
        toast.error(data.error?.message || 'Failed to fetch offer');
        router.push('/offers');
      }
    } catch {
      toast.error('Network error');
      router.push('/offers');
    } finally {
      setLoading(false);
    }
  }

  async function toggleCloak() {
    if (!offer) return;
    try {
      const response = await fetch(`/api/offers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloak_enabled: offer.cloak_enabled === 0 }),
      });
      const data = await response.json();
      if (data.success) {
        setOffer({ ...offer, cloak_enabled: offer.cloak_enabled === 0 ? 1 : 0 });
        toast.success(offer.cloak_enabled === 0 ? 'Cloak enabled' : 'Cloak disabled');
      } else {
        toast.error(data.error?.message || 'Failed to toggle cloak');
      }
    } catch {
      toast.error('Network error');
    }
  }

  async function updateStatus(newStatus: string) {
    if (!offer) return;
    try {
      const response = await fetch(`/api/offers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await response.json();
      if (data.success) {
        setOffer({ ...offer, status: newStatus });
        toast.success(`Status updated to ${newStatus}`);
      } else {
        toast.error(data.error?.message || 'Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
  }

  async function deleteOffer() {
    if (!confirm('Are you sure you want to delete this offer?')) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/offers/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Offer deleted');
        router.push('/offers');
      } else {
        toast.error(data.error?.message || 'Failed to delete offer');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!offer) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <Link
              href="/offers"
              className="text-gray-500 hover:text-gray-700"
            >
              ← Back
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{offer.brand_name}</h1>
          <p className="text-gray-500 mt-1">
            Created {new Date(offer.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            href={`/offers/${id}/edit`}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
          >
            Edit
          </Link>
          <button
            onClick={deleteOffer}
            disabled={deleting}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-medium disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Access URLs */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Access URLs</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  System URL
                </label>
                <div className="flex items-center space-x-2">
                  <code className="flex-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">
                    {offer.access_urls.system}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(offer.access_urls.system);
                      toast.success('Copied to clipboard');
                    }}
                    className="px-3 py-2 text-gray-600 hover:text-gray-900"
                  >
                    Copy
                  </button>
                  <a
                    href={offer.access_urls.system}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-blue-600 hover:text-blue-700"
                  >
                    Open
                  </a>
                </div>
              </div>
              {offer.access_urls.custom && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">
                    Custom Domain
                  </label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">
                      {offer.access_urls.custom}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(offer.access_urls.custom!);
                        toast.success('Copied to clipboard');
                      }}
                      className="px-3 py-2 text-gray-600 hover:text-gray-900"
                    >
                      Copy
                    </button>
                    <a
                      href={offer.access_urls.custom}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-blue-600 hover:text-blue-700"
                    >
                      Open
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Offer Details */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Offer Details</h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Brand URL</dt>
                <dd className="mt-1">
                  <a
                    href={offer.brand_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    {offer.brand_url}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Affiliate Link</dt>
                <dd className="mt-1">
                  <a
                    href={offer.affiliate_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 break-all"
                  >
                    {offer.affiliate_link}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Target Countries</dt>
                <dd className="mt-1">
                  {offer.target_countries && offer.target_countries.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {offer.target_countries.map((country) => (
                        <span
                          key={country}
                          className="px-2 py-1 bg-gray-100 rounded text-sm"
                        >
                          {country}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500">All countries</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Custom Domain */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Custom Domain</h2>
              <Link
                href={`/offers/${id}/domain`}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Configure
              </Link>
            </div>
            {offer.custom_domain ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{offer.custom_domain}</span>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      offer.custom_domain_status === 'verified'
                        ? 'bg-green-100 text-green-800'
                        : offer.custom_domain_status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {offer.custom_domain_status}
                  </span>
                </div>
                {offer.custom_domain_status === 'pending' && (
                  <p className="text-sm text-gray-500">
                    Add a CNAME record pointing to <code className="bg-gray-100 px-1 rounded">cname.autoguard.dev</code>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No custom domain configured</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Status</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Current Status</span>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    offer.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : offer.status === 'paused'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {offer.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['draft', 'active', 'paused'].map((status) => (
                  <button
                    key={status}
                    onClick={() => updateStatus(status)}
                    disabled={offer.status === status}
                    className={`px-3 py-1 text-sm rounded border ${
                      offer.status === status
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cloak */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Cloak</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600">
                  {offer.cloak_enabled ? 'Enabled' : 'Disabled'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {offer.cloak_enabled
                    ? 'Traffic filtering is active'
                    : 'All visitors see Money Page'}
                </p>
              </div>
              <button
                onClick={toggleCloak}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  offer.cloak_enabled ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    offer.cloak_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Quick Stats</h2>
              <Link
                href={`/offers/${id}/stats`}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                View All
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">-</p>
                <p className="text-xs text-gray-500">Total Visits</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">-</p>
                <p className="text-xs text-gray-500">Cloaked</p>
              </div>
            </div>
          </div>

          {/* Page Management */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Pages</h2>
            <div className="space-y-3">
              <Link
                href={`/offers/${id}/pages`}
                className="block w-full px-4 py-2 text-center border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
              >
                Manage Pages
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
