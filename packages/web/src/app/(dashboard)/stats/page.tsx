'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

interface OverallStats {
  totalVisits: number;
  moneyPageVisits: number;
  safePageVisits: number;
  uniqueIps: number;
  cloakRate: number;
}

interface DailyStat {
  date: string;
  totalVisits: number;
  moneyPageVisits: number;
  safePageVisits: number;
  uniqueIps: number;
}

interface OfferStat {
  offerId: number;
  brandName: string;
  totalVisits: number;
  moneyPageVisits: number;
  safePageVisits: number;
}

interface CountryStat {
  country: string;
  visits: number;
}

interface StatsData {
  overall: OverallStats;
  today: {
    totalVisits: number;
    moneyPageVisits: number;
    safePageVisits: number;
  };
  daily: DailyStat[];
  byOffer: OfferStat[];
  topCountries: CountryStat[];
  period: {
    start: string;
    end: string;
  };
}

type Period = '7d' | '30d' | '90d' | 'all';

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsData | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/stats?period=${period}`);
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error?.message || 'Failed to fetch statistics');
        return;
      }

      setStats(data.data);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading statistics...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">No data available</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Statistics</h1>
        <div className="flex items-center space-x-2">
          {(['7d', '30d', '90d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : p === '90d' ? '90 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Today Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Today&apos;s Visits</h3>
          <p className="text-3xl font-bold text-gray-900">
            {stats.today.totalVisits.toLocaleString()}
          </p>
          <div className="mt-2 flex items-center text-sm">
            <span className="text-green-600">
              {stats.today.moneyPageVisits} money
            </span>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-red-600">
              {stats.today.safePageVisits} safe
            </span>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Visits</h3>
          <p className="text-3xl font-bold text-gray-900">
            {stats.overall.totalVisits.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {stats.period.start} - {stats.period.end}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Cloak Rate</h3>
          <p className="text-3xl font-bold text-gray-900">
            {stats.overall.cloakRate}%
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Traffic shown Safe Page
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Unique IPs</h3>
          <p className="text-3xl font-bold text-gray-900">
            {stats.overall.uniqueIps.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Distinct visitors
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Money vs Safe */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Traffic Distribution</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-green-600 font-medium">Money Page</span>
                <span>{stats.overall.moneyPageVisits.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full"
                  style={{
                    width: `${stats.overall.totalVisits > 0 ? (stats.overall.moneyPageVisits / stats.overall.totalVisits) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-red-600 font-medium">Safe Page</span>
                <span>{stats.overall.safePageVisits.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-red-500 h-3 rounded-full"
                  style={{
                    width: `${stats.overall.totalVisits > 0 ? (stats.overall.safePageVisits / stats.overall.totalVisits) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Top Countries */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Countries</h3>
          {stats.topCountries.length === 0 ? (
            <p className="text-gray-500 text-sm">No data yet</p>
          ) : (
            <div className="space-y-2">
              {stats.topCountries.slice(0, 8).map((country, index) => (
                <div key={country.country} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-gray-400 text-sm w-6">{index + 1}</span>
                    <span className="font-medium text-gray-900">
                      {country.country || 'Unknown'}
                    </span>
                  </div>
                  <span className="text-gray-600">{country.visits.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By Offer */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">By Offer</h3>
            <Link href="/offers" className="text-blue-600 hover:text-blue-700 text-sm">
              View All
            </Link>
          </div>
          {stats.byOffer.length === 0 ? (
            <p className="text-gray-500 text-sm">No offers yet</p>
          ) : (
            <div className="space-y-3">
              {stats.byOffer.slice(0, 6).map((offer) => (
                <Link
                  key={offer.offerId}
                  href={`/offers/${offer.offerId}/stats`}
                  className="block hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 truncate">
                      {offer.brandName}
                    </span>
                    <span className="text-gray-600 text-sm">
                      {offer.totalVisits.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center text-xs text-gray-500 mt-1">
                    <span className="text-green-600">{offer.moneyPageVisits} money</span>
                    <span className="mx-1">|</span>
                    <span className="text-red-600">{offer.safePageVisits} safe</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Daily Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Daily Traffic</h3>
          <Link href="/logs" className="text-blue-600 hover:text-blue-700 text-sm">
            View Logs
          </Link>
        </div>

        {stats.daily.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">No data for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Money
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Safe
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Unique IPs
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Cloak Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {stats.daily.slice(-30).reverse().map((day) => {
                  const cloakRate = day.totalVisits > 0
                    ? Math.round((day.safePageVisits / day.totalVisits) * 100)
                    : 0;
                  return (
                    <tr key={day.date} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(day.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                        {day.totalVisits.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-green-600 text-right">
                        {day.moneyPageVisits.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-red-600 text-right">
                        {day.safePageVisits.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">
                        {day.uniqueIps.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          cloakRate > 50
                            ? 'bg-red-100 text-red-700'
                            : cloakRate > 20
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {cloakRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
