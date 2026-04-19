/**
 * AdDrawerPanel — host-facing drawer of available sponsor/product creatives.
 *
 * Clicking a card's "Show now" button triggers the overlay via POST
 * /sessions/{id}/promo/trigger. Empty state shown when no items (e.g. when
 * vnl-ads is not yet reachable / feature flag is off).
 */

import { useState } from 'react';
import { useAdDrawer } from './useAdDrawer';

interface AdDrawerPanelProps {
  sessionId: string;
}

export function AdDrawerPanel({ sessionId }: AdDrawerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { items, loading, triggering, cappedCreativeIds, refresh, trigger } = useAdDrawer(sessionId);
  const [lastStatus, setLastStatus] = useState<{ creativeId: string; delivered: boolean; reason?: string } | null>(null);

  const handleShowNow = async (creativeId: string) => {
    const { delivered, reason } = await trigger(creativeId);
    setLastStatus({ creativeId, delivered, reason });
  };

  return (
    <aside
      className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden text-sm"
      aria-label="Sponsor promotions drawer"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">Promotions</span>
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50"
            aria-label="Refresh promotions"
          >
            {loading ? '…' : 'Refresh'}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
            aria-label={collapsed ? 'Expand promotions drawer' : 'Collapse promotions drawer'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="p-2 max-h-72 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-6 px-2">
              {loading ? 'Loading…' : 'No promotions available'}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const capped = cappedCreativeIds.has(item.creativeId);
                return (
                  <li
                    key={item.creativeId}
                    className={`flex items-center gap-2 p-2 border border-gray-100 rounded-md ${
                      capped ? 'opacity-60 bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-100"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800 truncate" title={item.title}>
                        {item.title}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1">
                        <span>
                          {item.type} · {item.durationMs !== null && item.durationMs !== undefined ? `${(item.durationMs / 1000).toFixed(1)}s` : '—'}
                        </span>
                        {capped && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 tracking-normal normal-case font-medium">
                            Cap reached
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleShowNow(item.creativeId)}
                      disabled={triggering || capped}
                      className="px-2 py-1 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {capped ? 'Capped' : 'Show now'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {lastStatus && (
            <div
              className={`mt-2 text-[11px] px-2 py-1 rounded ${
                lastStatus.delivered
                  ? 'bg-green-50 text-green-700'
                  : 'bg-yellow-50 text-yellow-700'
              }`}
            >
              {lastStatus.delivered
                ? 'Overlay sent to viewers.'
                : lastStatus.reason === 'cap_reached'
                  ? 'Frequency cap reached — creative greyed out.'
                  : lastStatus.reason === 'schedule_out_of_window'
                    ? 'Campaign is outside its scheduled window.'
                    : 'Not delivered.'}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
