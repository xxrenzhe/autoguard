'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

interface DomainStatus {
  custom_domain: string | null;
  custom_domain_status: string | null;
  custom_domain_verified_at: string | null;
  cname_target: string;
}

export default function CustomDomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [domainStatus, setDomainStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  useEffect(() => {
    fetchDomainStatus();
  }, [id]);

  async function fetchDomainStatus() {
    try {
      const response = await fetch(`/api/offers/${id}/custom-domain`);
      const data = await response.json();
      if (data.success) {
        setDomainStatus(data.data);
        if (data.data.custom_domain) {
          setNewDomain(data.data.custom_domain);
        }
      } else {
        toast.error(data.error?.message || 'Failed to fetch domain status');
        router.push(`/offers/${id}`);
      }
    } catch {
      toast.error('Network error');
      router.push(`/offers/${id}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!newDomain.trim()) {
      toast.error('Please enter a domain');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/offers/${id}/custom-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to set domain');
        return;
      }

      toast.success('Domain configured. Please add the CNAME record.');
      setDomainStatus({
        ...domainStatus!,
        custom_domain: data.data.custom_domain,
        custom_domain_status: 'pending',
        custom_domain_verified_at: null,
      });
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const response = await fetch(`/api/offers/${id}/custom-domain`, {
        method: 'PUT',
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to verify domain');
        return;
      }

      if (data.data.verified) {
        toast.success('Domain verified successfully!');
        setDomainStatus({
          ...domainStatus!,
          custom_domain_status: 'verified',
          custom_domain_verified_at: new Date().toISOString(),
        });
      } else {
        toast.error(data.data.message || 'Verification failed');
        if (data.data.custom_domain_status === 'failed') {
          setDomainStatus({
            ...domainStatus!,
            custom_domain_status: 'failed',
          });
        }
      }
    } catch {
      toast.error('Network error');
    } finally {
      setVerifying(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Are you sure you want to remove the custom domain?')) return;

    setRemoving(true);
    try {
      const response = await fetch(`/api/offers/${id}/custom-domain`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to remove domain');
        return;
      }

      toast.success('Custom domain removed');
      setDomainStatus({
        ...domainStatus!,
        custom_domain: null,
        custom_domain_status: null,
        custom_domain_verified_at: null,
      });
      setNewDomain('');
    } catch {
      toast.error('Network error');
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!domainStatus) {
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center space-x-3 mb-6">
        <Link
          href={`/offers/${id}`}
          className="text-gray-500 hover:text-gray-700"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Custom Domain</h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* Current Status */}
        {domainStatus.custom_domain && (
          <div className="border-b pb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Domain</h2>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <code className="text-lg font-mono">{domainStatus.custom_domain}</code>
                <div className="mt-2">
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      domainStatus.custom_domain_status === 'verified'
                        ? 'bg-green-100 text-green-800'
                        : domainStatus.custom_domain_status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {domainStatus.custom_domain_status === 'verified'
                      ? 'Verified'
                      : domainStatus.custom_domain_status === 'pending'
                      ? 'Pending Verification'
                      : 'Verification Failed'}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {domainStatus.custom_domain_status !== 'verified' && (
                  <button
                    onClick={handleVerify}
                    disabled={verifying}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    {verifying ? 'Verifying...' : 'Verify Now'}
                  </button>
                )}
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 font-medium"
                >
                  {removing ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>

            {/* DNS Instructions */}
            {domainStatus.custom_domain_status !== 'verified' && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">DNS Configuration Required</h3>
                <p className="text-sm text-blue-800 mb-3">
                  Add the following CNAME record to your domain&apos;s DNS settings:
                </p>
                <div className="bg-white rounded border p-3 font-mono text-sm">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <span className="text-gray-500 text-xs block">Type</span>
                      CNAME
                    </div>
                    <div>
                      <span className="text-gray-500 text-xs block">Name</span>
                      {domainStatus.custom_domain.split('.')[0]}
                    </div>
                    <div>
                      <span className="text-gray-500 text-xs block">Target</span>
                      {domainStatus.cname_target}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-blue-700 mt-3">
                  DNS propagation may take up to 48 hours. After adding the record, click &quot;Verify Now&quot; to check.
                </p>
              </div>
            )}

            {domainStatus.custom_domain_status === 'verified' && domainStatus.custom_domain_verified_at && (
              <p className="mt-3 text-sm text-gray-500">
                Verified on {new Date(domainStatus.custom_domain_verified_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        {/* Set New Domain */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {domainStatus.custom_domain ? 'Change Domain' : 'Configure Domain'}
          </h2>
          <form onSubmit={handleSetDomain} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Domain Name
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="landing.yourdomain.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
              <p className="mt-2 text-sm text-gray-500">
                Enter your custom domain (e.g., landing.yourdomain.com or promo.yourdomain.com)
              </p>
            </div>
            <button
              type="submit"
              disabled={saving || !newDomain.trim() || newDomain === domainStatus.custom_domain}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : domainStatus.custom_domain ? 'Update Domain' : 'Set Domain'}
            </button>
          </form>
        </div>

        {/* Help Section */}
        <div className="border-t pt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">How it works</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>Enter your custom domain above and click &quot;Set Domain&quot;</li>
            <li>Go to your domain registrar&apos;s DNS settings</li>
            <li>Add a CNAME record pointing to <code className="bg-gray-100 px-1 rounded">{domainStatus.cname_target}</code></li>
            <li>Wait for DNS propagation (usually 5-30 minutes, up to 48 hours)</li>
            <li>Click &quot;Verify Now&quot; to confirm the configuration</li>
            <li>Once verified, your custom domain will be active</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
