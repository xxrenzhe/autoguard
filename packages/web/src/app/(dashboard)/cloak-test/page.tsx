'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type OfferOption = {
  id: number;
  brandName: string;
  subdomain: string;
  status: string;
  cloakEnabled: boolean;
};

type OffersResponse = {
  data: OfferOption[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
};

type CloakTestResult = {
  decision: 'money' | 'safe';
  score: number;
  decisionReason?: string;
  blockedAtLayer?: string | null;
  processingTimeMs?: number;
  details?: unknown;
  offer?: { id: number; brandName?: string; subdomain?: string; status?: string };
  testParams?: unknown;
};

type CloakTestResponse = { data: CloakTestResult };

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CloakTestPage() {
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);

  const [ip, setIp] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [referer, setReferer] = useState('');
  const [url, setUrl] = useState('/');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CloakTestResult | null>(null);

  const selectedOffer = useMemo(
    () => offers.find((o) => o.id === selectedOfferId) || null,
    [offers, selectedOfferId]
  );

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !userAgent) {
      setUserAgent(navigator.userAgent);
    }
  }, [userAgent]);

  const fetchOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const res = await fetch('/api/offers?limit=100&page=1', { cache: 'no-store' });
      const body = (await res.json()) as OffersResponse;
      if (!res.ok) {
        toast.error((body as unknown as { error?: { message?: string } }).error?.message || 'Failed to load offers');
        return;
      }
      setOffers(body.data || []);

      setSelectedOfferId((current) => current ?? (body.data?.[0]?.id ?? null));
    } catch {
      toast.error('Network error');
    } finally {
      setOffersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const runTest = async () => {
    if (!selectedOfferId) {
      toast.error('Please select an offer');
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      const res = await fetch('/api/cloak/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: selectedOfferId,
          ip: ip || undefined,
          userAgent: userAgent || undefined,
          referer: referer || undefined,
          url: url || '/',
        }),
      });
      const body = (await res.json()) as CloakTestResponse;
      if (!res.ok) {
        toast.error((body as unknown as { error?: { message?: string } }).error?.message || 'Test failed');
        return;
      }

      setResult(body.data);
    } catch {
      toast.error('Network error');
    } finally {
      setRunning(false);
    }
  };

  const badgeVariant = result?.decision === 'money' ? 'success' : 'warning';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cloak Test</h1>
          <p className="text-sm text-gray-600">
            High score = more trusted. If score is below the threshold (default 60), decision becomes Safe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchOffers} disabled={offersLoading}>
            {offersLoading ? 'Loading...' : 'Reload offers'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer">Offer</Label>
              <Select
                value={selectedOfferId ? String(selectedOfferId) : ''}
                onValueChange={(value) => setSelectedOfferId(value ? parseInt(value, 10) : null)}
                disabled={offersLoading || offers.length === 0}
              >
                <SelectTrigger id="offer">
                  <SelectValue placeholder={offersLoading ? 'Loading offers…' : 'Select an offer'} />
                </SelectTrigger>
                <SelectContent>
                  {offers.map((offer) => (
                    <SelectItem key={offer.id} value={String(offer.id)}>
                      {offer.brandName} ({offer.subdomain}){offer.cloakEnabled ? '' : ' • cloak off'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedOffer ? (
                <p className="text-xs text-gray-500">
                  Status: {selectedOffer.status} · Subdomain: {selectedOffer.subdomain}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ip">IP (optional)</Label>
              <Input
                id="ip"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="e.g. 8.8.8.8 or 2606:4700:4700::1111"
                inputMode="text"
              />
              <p className="text-xs text-gray-500">Leave empty to use default IP in the API.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ua">User-Agent (optional)</Label>
            <Textarea
              id="ua"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              placeholder="Paste a full User-Agent string"
              className="min-h-[88px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="referer">Referer (optional)</Label>
              <Input
                id="referer"
                value={referer}
                onChange={(e) => setReferer(e.target.value)}
                placeholder="https://example.com/"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">Request URL</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/?gclid=..."
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={runTest} disabled={running || offersLoading || offers.length === 0}>
              {running ? 'Running…' : 'Run test'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setResult(null)}
              disabled={running || !result}
            >
              Clear result
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>Result</CardTitle>
            {result ? <Badge variant={badgeVariant}>{result.decision}</Badge> : <Badge variant="outline">No data</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <div className="text-sm text-gray-600">Run a test to see decision details.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-gray-500">Score</div>
                  <div className="font-mono text-lg text-gray-900">{result.score}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-gray-500">Blocked At</div>
                  <div className="font-mono text-sm text-gray-900">{result.blockedAtLayer || '-'}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-gray-500">Time</div>
                  <div className="font-mono text-sm text-gray-900">
                    {typeof result.processingTimeMs === 'number' ? `${result.processingTimeMs}ms` : '-'}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-gray-500">Offer</div>
                  <div className="font-mono text-sm text-gray-900">{result.offer?.subdomain || selectedOffer?.subdomain || '-'}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-900">Reason</div>
                <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-800">
                  {result.decisionReason || '—'}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-900">Details</div>
                <pre className="max-h-[420px] overflow-auto rounded-md border bg-gray-950 p-4 text-xs text-gray-100">
                  {formatJson(result.details)}
                </pre>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
