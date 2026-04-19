/**
 * SearchPage — route `/search?q=...&filter=...`. Grid of discovery
 * SessionCards using the shared /search endpoint.
 */
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { SearchInput, TabNav, type Tab } from '../components/social';
import { SessionCardGrid } from '../features/common/SessionCard';
import { useSessionSearch } from '../features/common/useDiscovery';

type Filter = '' | 'live' | 'ended';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const filterParam = (params.get('filter') ?? '') as Filter;

  // Local input state — keeps keystrokes snappy while the committed query
  // (what gets sent to the API) only changes on submit.
  const [inputValue, setInputValue] = useState(q);
  useEffect(() => { setInputValue(q); }, [q]);

  const filter = filterParam === 'live' || filterParam === 'ended' ? filterParam : undefined;
  const { items, loading, error } = useSessionSearch(q, filter);

  const tabs = useMemo<Tab[]>(() => [
    { id: '', label: 'All' },
    { id: 'live', label: 'Live' },
    { id: 'ended', label: 'Past' },
  ], []);

  const onSubmit = (value: string) => {
    const t = value.trim();
    const next = new URLSearchParams(params);
    if (t) next.set('q', t); else next.delete('q');
    setParams(next);
  };

  const onTabChange = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('filter', id); else next.delete('filter');
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <section className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-9 h-9 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
            aria-label="Back"
            title="Back"
          >
            <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <SearchInput
              placeholder="Search sessions, creators, tags..."
              value={inputValue}
              onChange={setInputValue}
              onSubmit={onSubmit}
            />
          </div>
        </div>
        <TabNav
          tabs={tabs}
          activeTab={filter ?? ''}
          onChange={onTabChange}
          variant="underline"
        />
      </section>

      <section>
        {q ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {loading ? 'Searching…' : `${items.length} result${items.length === 1 ? '' : 's'} for "${q}"`}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Enter a search to find sessions, creators, or tags.
          </p>
        )}
        {error ? (
          <div className="text-center py-8 text-sm text-red-600">{error}</div>
        ) : (
          <SessionCardGrid
            items={items}
            loading={loading && !!q}
            emptyMessage={q ? 'No sessions match that search.' : 'Start typing to search.'}
          />
        )}
      </section>
    </div>
  );
}
