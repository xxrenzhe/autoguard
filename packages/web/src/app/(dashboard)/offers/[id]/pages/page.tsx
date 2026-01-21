'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

interface PageData {
  id: number;
  offerId: number;
  variant: 'a' | 'b';
  sourceType: string;
  sourceUrl: string | null;
  localPath: string | null;
  status: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface OfferInfo {
  id: number;
  brandName: string;
  subdomain: string;
}

export default function OfferPagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [offer, setOffer] = useState<OfferInfo | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalVariant, setModalVariant] = useState<'a' | 'b'>('a');
  const [modalUrl, setModalUrl] = useState('');
  const [modalSafePageType, setModalSafePageType] = useState<'review' | 'tips' | 'comparison' | 'guide'>('review');
  const [modalCompetitors, setModalCompetitors] = useState('');

  useEffect(() => {
    fetchPages();
  }, [id]);

  async function fetchPages() {
    try {
      const response = await fetch(`/api/offers/${id}/pages`);
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to fetch pages');
        return;
      }

      setOffer(data.data.offer);
      setPages(data.data.pages);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    const action = modalVariant === 'a' ? 'scrape' : 'ai_generate';

    if (action === 'scrape' && !modalUrl) {
      toast.error('Please enter a URL to scrape');
      return;
    }

    const competitors =
      action === 'ai_generate'
        ? modalCompetitors
            .split(/[\n,]+/)
            .map((c) => c.trim())
            .filter(Boolean)
        : [];

    if (action === 'ai_generate' && modalSafePageType === 'comparison' && competitors.length === 0) {
      toast.error('Please enter at least one competitor for Comparison pages');
      return;
    }

    setGenerating(modalVariant);
    setShowModal(false);

    try {
      const response = await fetch(`/api/offers/${id}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant: modalVariant,
          action,
          sourceUrl: action === 'scrape' ? (modalUrl || undefined) : undefined,
          safePageType: action === 'ai_generate' ? modalSafePageType : undefined,
          competitors: action === 'ai_generate' && competitors.length > 0 ? competitors : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to start generation');
        return;
      }

      toast.success(data.message || 'Page generation started');
      // Refresh pages list
      fetchPages();
    } catch {
      toast.error('Network error');
    } finally {
      setGenerating(null);
    }
  }

  function openGenerateModal(variant: 'a' | 'b') {
    setModalVariant(variant);
    if (variant === 'a') {
      setModalUrl('');
    } else {
      setModalUrl('');
      setModalSafePageType('review');
      setModalCompetitors('');
    }
    setShowModal(true);
  }

  const moneyPage = pages.find((p) => p.variant === 'a');
  const safePage = pages.find((p) => p.variant === 'b');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center space-x-3 mb-6">
        <Link
          href={`/offers/${id}`}
          className="text-gray-500 hover:text-gray-700"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Page Management: {offer?.brandName}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Money Page (Variant A) */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Money Page</h2>
                <p className="text-sm text-gray-500">Shown to real users</p>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                Variant A
              </span>
            </div>
          </div>

          <div className="p-6">
            {moneyPage ? (
              <div className="space-y-4">
                <div>
                  <span className="text-xs text-gray-500 block">Status</span>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    moneyPage.status === 'ready'
                      ? 'bg-green-100 text-green-700'
                      : moneyPage.status === 'generating'
                      ? 'bg-yellow-100 text-yellow-700'
                      : moneyPage.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {moneyPage.status}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-gray-500 block">Source Type</span>
                  <span className="text-sm text-gray-900">{moneyPage.sourceType}</span>
                </div>

                {moneyPage.sourceUrl && (
                  <div>
                    <span className="text-xs text-gray-500 block">Source URL</span>
                    <a
                      href={moneyPage.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 break-all"
                    >
                      {moneyPage.sourceUrl}
                    </a>
                  </div>
                )}

                <div>
                  <span className="text-xs text-gray-500 block">Last Updated</span>
                  <span className="text-sm text-gray-900">
                    {new Date(moneyPage.updatedAt).toLocaleString()}
                  </span>
                </div>

                <div className="pt-4 flex space-x-2">
                  <button
                    onClick={() => openGenerateModal('a')}
                    disabled={generating === 'a'}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {generating === 'a' ? 'Generating...' : 'Regenerate'}
                  </button>
                  {moneyPage.status === 'ready' && (
                    <a
                      href={`https://${offer?.subdomain}.autoguard.dev`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Preview
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No money page configured</p>
                <button
                  onClick={() => openGenerateModal('a')}
                  disabled={generating === 'a'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {generating === 'a' ? 'Generating...' : 'Generate Money Page'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Safe Page (Variant B) */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Safe Page</h2>
                <p className="text-sm text-gray-500">Shown to bots/crawlers</p>
              </div>
              <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
                Variant B
              </span>
            </div>
          </div>

          <div className="p-6">
            {safePage ? (
              <div className="space-y-4">
                <div>
                  <span className="text-xs text-gray-500 block">Status</span>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    safePage.status === 'ready'
                      ? 'bg-green-100 text-green-700'
                      : safePage.status === 'generating'
                      ? 'bg-yellow-100 text-yellow-700'
                      : safePage.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {safePage.status}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-gray-500 block">Source Type</span>
                  <span className="text-sm text-gray-900">{safePage.sourceType}</span>
                </div>

                {safePage.sourceUrl && (
                  <div>
                    <span className="text-xs text-gray-500 block">Source URL</span>
                    <a
                      href={safePage.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 break-all"
                    >
                      {safePage.sourceUrl}
                    </a>
                  </div>
                )}

                <div>
                  <span className="text-xs text-gray-500 block">Last Updated</span>
                  <span className="text-sm text-gray-900">
                    {new Date(safePage.updatedAt).toLocaleString()}
                  </span>
                </div>

                <div className="pt-4 flex space-x-2">
                  <button
                    onClick={() => openGenerateModal('b')}
                    disabled={generating === 'b'}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {generating === 'b' ? 'Generating...' : 'Regenerate'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No safe page configured</p>
                <button
                  onClick={() => openGenerateModal('b')}
                  disabled={generating === 'b'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {generating === 'b' ? 'Generating...' : 'Generate Safe Page'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Page Paths Info */}
      <div className="mt-6 bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Page Storage Paths</h3>
        <div className="space-y-3 font-mono text-sm">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <span className="text-gray-600">Money Page (A):</span>
            <code className="text-gray-900">/data/pages/{offer?.subdomain}/a/</code>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <span className="text-gray-600">Safe Page (B):</span>
            <code className="text-gray-900">/data/pages/{offer?.subdomain}/b/</code>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <span className="text-gray-600">Static Assets:</span>
            <code className="text-gray-900">/static/{offer?.subdomain}/[a|b]/assets/</code>
          </div>
        </div>
      </div>

      {/* Generate Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Generate {modalVariant === 'a' ? 'Money' : 'Safe'} Page
            </h2>

            <div className="space-y-4">
              {modalVariant === 'a' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    URL to Scrape
                  </label>
                  <input
                    type="url"
                    value={modalUrl}
                    onChange={(e) => setModalUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Safe Page Type
                    </label>
                    <select
                      value={modalSafePageType}
                      onChange={(e) =>
                        setModalSafePageType(e.target.value as typeof modalSafePageType)
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="review">Review</option>
                      <option value="tips">Tips</option>
                      <option value="comparison">Comparison</option>
                      <option value="guide">Guide</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Competitors {modalSafePageType === 'comparison' ? '(required)' : '(optional)'}
                    </label>
                    <textarea
                      value={modalCompetitors}
                      onChange={(e) => setModalCompetitors(e.target.value)}
                      placeholder="Canva, Adobe Premiere, ..."
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Enter competitor names separated by commas or new lines.
                    </p>
                  </div>

                  <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                    AI will generate a compliance-friendly Safe Page based on the offer information.
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Start Generation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
