'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type QueueCounts = {
  pending: number;
  processing: number;
  delayed?: number;
  dead?: number;
};

type QueuesPayload = {
  now: string;
  queues: {
    pageGeneration: QueueCounts;
    cloakLogs: QueueCounts;
    blacklistSync: QueueCounts;
  };
};

type QueuesResponse = { data: QueuesPayload };

type DeadJob = {
  index: number;
  raw: string;
  pageId: number | null;
  offerId: number | null;
  variant: string | null;
  action: string | null;
  attempt: number | null;
  failedAt: string | null;
  error: string | null;
};

type DeadJobsPayload = { total: number; limit: number; items: DeadJob[] };
type DeadJobsResponse = { data: DeadJobsPayload };

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return value;
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="font-mono text-sm text-gray-900">{value}</span>
    </div>
  );
}

function QueueCard({ title, data }: { title: string; data: QueueCounts }) {
  const hasDead = (data.dead || 0) > 0;
  const hasBacklog = data.pending > 0 || data.processing > 0 || (data.delayed || 0) > 0;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex items-center gap-2">
            {hasDead ? (
              <Badge variant="destructive">Dead</Badge>
            ) : hasBacklog ? (
              <Badge variant="secondary">Active</Badge>
            ) : (
              <Badge variant="outline">Idle</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Stat label="Pending" value={data.pending} />
        <Stat label="Processing" value={data.processing} />
        {typeof data.delayed === 'number' ? <Stat label="Delayed" value={data.delayed} /> : null}
        {typeof data.dead === 'number' ? <Stat label="Dead" value={data.dead} /> : null}
      </CardContent>
    </Card>
  );
}

export default function AdminQueuesPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<QueuesPayload | null>(null);
  const [deadLoading, setDeadLoading] = useState(false);
  const [deadTotal, setDeadTotal] = useState(0);
  const [deadJobs, setDeadJobs] = useState<DeadJob[]>([]);
  const [requeueing, setRequeueing] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/queues', { cache: 'no-store' });
      const body = (await res.json()) as QueuesResponse;
      if (!res.ok) {
        toast.error((body as unknown as { error?: { message?: string } }).error?.message || '获取队列状态失败');
        return;
      }
      setPayload(body.data);
    } catch {
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const fetchDeadJobs = async () => {
    setDeadLoading(true);
    try {
      const res = await fetch('/api/admin/queues/page-generation/dead?limit=20', { cache: 'no-store' });
      const body = (await res.json()) as DeadJobsResponse;
      if (!res.ok) {
        toast.error((body as unknown as { error?: { message?: string } }).error?.message || '获取 DLQ 失败任务失败');
        return;
      }
      setDeadTotal(body.data.total || 0);
      setDeadJobs(body.data.items || []);
    } catch {
      toast.error('网络错误');
    } finally {
      setDeadLoading(false);
    }
  };

  const refresh = async () => {
    await Promise.all([fetchStatus(), fetchDeadJobs()]);
  };

  const requeueJob = async (jobData: string) => {
    if (!confirm('确定要重放该任务吗？将重置 attempt 并重新入队。')) return;

    setRequeueing(jobData);
    try {
      const res = await fetch('/api/admin/queues/page-generation/dead/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobData, resetAttempt: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error?.message || '重放失败');
        return;
      }
      toast.success('已重放任务');
      await refresh();
    } catch {
      toast.error('网络错误');
    } finally {
      setRequeueing(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Queues</h1>
          <p className="text-sm text-gray-600">
            {payload?.now ? `Updated at ${new Date(payload.now).toLocaleString()}` : 'Queue status overview'}
          </p>
        </div>
        <Button onClick={refresh} disabled={loading || deadLoading}>
          {loading || deadLoading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <QueueCard title="Page Generation" data={payload?.queues.pageGeneration || { pending: 0, processing: 0, delayed: 0, dead: 0 }} />
        <QueueCard title="Cloak Logs" data={payload?.queues.cloakLogs || { pending: 0, processing: 0 }} />
        <QueueCard title="Blacklist Sync" data={payload?.queues.blacklistSync || { pending: 0, processing: 0 }} />
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>Page Generation DLQ</CardTitle>
            <Badge variant={deadTotal > 0 ? 'destructive' : 'outline'}>{deadTotal} dead</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {deadTotal === 0 ? (
            <div className="text-sm text-gray-600">No dead jobs.</div>
          ) : deadJobs.length === 0 ? (
            <div className="text-sm text-gray-600">{deadLoading ? 'Loading…' : 'No items loaded.'}</div>
          ) : (
            <div className="space-y-3">
              {deadJobs.map((job) => (
                <div key={`${job.index}-${job.pageId ?? 'x'}-${job.offerId ?? 'x'}`} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono">pageId={job.pageId ?? '-'}</span>
                      <span className="font-mono">offerId={job.offerId ?? '-'}</span>
                      <Badge variant="secondary">{job.action || 'unknown'}</Badge>
                      <Badge variant="outline">{job.variant || '-'}</Badge>
                      {typeof job.attempt === 'number' ? (
                        <span className="font-mono text-xs text-gray-600">attempt={job.attempt}</span>
                      ) : null}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => requeueJob(job.raw)}
                      disabled={requeueing === job.raw}
                    >
                      {requeueing === job.raw ? 'Requeueing…' : 'Requeue'}
                    </Button>
                  </div>

                  {job.error ? (
                    <div className="mt-2 rounded-md bg-gray-50 p-2 text-sm text-gray-800">
                      {job.error}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>failedAt: {job.failedAt || '-'}</span>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-gray-700">Raw job JSON</summary>
                    <pre className="mt-2 max-h-[260px] overflow-auto rounded-md border bg-gray-950 p-3 text-xs text-gray-100">
                      {formatJson(job.raw)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
