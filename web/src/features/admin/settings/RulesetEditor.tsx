/**
 * Phase 4: Admin UI for configuring image-moderation rulesets.
 *
 * Mounted inside AdminSettingsPanel at /settings/admin. Lists rulesets (classroom/hangout/broadcast
 * seeded by default), lets admins edit disallowed items + severity + description,
 * saves as a new version, supports rollback, and has a "Test" button that
 * uploads an image and shows the raw Nova Lite classification JSON.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';

type Severity = 'low' | 'med' | 'high';

interface Ruleset {
  name: string;
  version: number;
  description: string;
  disallowedItems: string[];
  severity: Severity;
  createdBy: string;
  createdAt: string;
  active: boolean;
  frameIntervalSec?: number;
  autoBounceThreshold?: number;
}

const FRAME_INTERVAL_MIN = 3;
const FRAME_INTERVAL_MAX = 60;
const AUTO_BOUNCE_MIN = 1;
const AUTO_BOUNCE_MAX = 10;

interface RulesetDetail {
  current: Ruleset | null;
  activeVersion: number;
  versions: Ruleset[];
}

interface Classification {
  flagged: boolean;
  items: string[];
  confidence: number;
  reasoning: string;
}

export function RulesetEditor() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [authToken, setAuthToken] = useState('');
  const [rulesets, setRulesets] = useState<Ruleset[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RulesetDetail | null>(null);
  const [error, setError] = useState('');

  // Edit form
  const [editDescription, setEditDescription] = useState('');
  const [editItems, setEditItems] = useState<string[]>([]);
  const [newItemDraft, setNewItemDraft] = useState('');
  const [editSeverity, setEditSeverity] = useState<Severity>('high');
  const [editFrameIntervalSec, setEditFrameIntervalSec] = useState<number>(10);
  const [editAutoBounceThreshold, setEditAutoBounceThreshold] = useState<number>(3);
  const [saving, setSaving] = useState(false);

  // Test
  const [testing, setTesting] = useState(false);
  const [classification, setClassification] = useState<Classification | null>(null);

  useEffect(() => {
    fetchToken().then(({ token }) => setAuthToken(token)).catch(() => setError('Failed to authenticate'));
  }, []);

  const loadRulesets = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const resp = await fetch(`${apiBaseUrl}/admin/rulesets`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { rulesets: Ruleset[] };
      setRulesets(data.rulesets);
      if (!selected && data.rulesets.length > 0) setSelected(data.rulesets[0].name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rulesets');
    }
  }, [authToken, apiBaseUrl, selected]);

  useEffect(() => {
    loadRulesets();
  }, [loadRulesets]);

  const loadDetail = useCallback(async () => {
    if (!authToken || !apiBaseUrl || !selected) return;
    try {
      const resp = await fetch(`${apiBaseUrl}/admin/rulesets/${encodeURIComponent(selected)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as RulesetDetail;
      setDetail(data);
      if (data.current) {
        setEditDescription(data.current.description);
        setEditItems([...data.current.disallowedItems]);
        setEditSeverity(data.current.severity);
        setEditFrameIntervalSec(data.current.frameIntervalSec ?? 10);
        setEditAutoBounceThreshold(data.current.autoBounceThreshold ?? 3);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load detail');
    }
  }, [authToken, apiBaseUrl, selected]);

  useEffect(() => {
    setClassification(null);
    loadDetail();
  }, [loadDetail]);

  const handleAddItem = () => {
    const item = newItemDraft.trim();
    if (!item) return;
    setEditItems((prev) => Array.from(new Set([...prev, item])));
    setNewItemDraft('');
  };

  const handleRemoveItem = (item: string) => {
    setEditItems((prev) => prev.filter((i) => i !== item));
  };

  const handleSaveVersion = async () => {
    if (!authToken || !selected) return;
    if (editItems.length === 0) {
      setError('Need at least one disallowed item');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const resp = await fetch(`${apiBaseUrl}/admin/rulesets/${encodeURIComponent(selected)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: editDescription,
          disallowedItems: editItems,
          severity: editSeverity,
          frameIntervalSec: editFrameIntervalSec,
          autoBounceThreshold: editAutoBounceThreshold,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await loadDetail();
      await loadRulesets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async (toVersion: number) => {
    if (!authToken || !selected) return;
    try {
      const resp = await fetch(
        `${apiBaseUrl}/admin/rulesets/${encodeURIComponent(selected)}/rollback`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ toVersion }),
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await loadDetail();
      await loadRulesets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    }
  };

  const handleTestUpload = async (file: File) => {
    if (!authToken || !selected) return;
    setTesting(true);
    setError('');
    setClassification(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const b64 = result.split(',')[1] ?? '';
          resolve(b64);
        };
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const resp = await fetch(
        `${apiBaseUrl}/admin/rulesets/${encodeURIComponent(selected)}/test`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image: base64 }),
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { classification: Classification };
      setClassification(data.classification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-[calc(100vh-64px)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Moderation Rulesets</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure which items/behaviors Nova Lite flags per session type.
          </p>
        </header>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-6">
          {/* Ruleset list */}
          <nav className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            {!rulesets && <div className="p-3 text-sm text-gray-500">Loading...</div>}
            {rulesets?.length === 0 && (
              <div className="p-3 text-sm text-gray-500">No rulesets yet.</div>
            )}
            {rulesets?.map((r) => (
              <button
                key={r.name}
                type="button"
                onClick={() => setSelected(r.name)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  r.name === selected
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <div className="font-medium">{r.name}</div>
                <div className={`text-xs ${r.name === selected ? 'text-blue-100' : 'text-gray-500'}`}>
                  v{r.version} — {r.severity} — {r.disallowedItems.length} items
                </div>
              </button>
            ))}
          </nav>

          {/* Editor */}
          <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            {!detail && <div className="text-sm text-gray-500">Select a ruleset</div>}
            {detail?.current && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {detail.current.name}
                  </h2>
                  <span className="text-xs text-gray-500">
                    Active: v{detail.activeVersion}
                  </span>
                </div>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Description
                </label>
                <textarea
                  className="w-full mb-4 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Severity
                </label>
                <select
                  className="mb-4 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                  value={editSeverity}
                  onChange={(e) => setEditSeverity(e.target.value as Severity)}
                >
                  <option value="high">high (flag &gt; 0.6)</option>
                  <option value="med">med (flag &gt; 0.75)</option>
                  <option value="low">low (flag &gt; 0.9)</option>
                </select>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      Frame interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={FRAME_INTERVAL_MIN}
                      max={FRAME_INTERVAL_MAX}
                      value={editFrameIntervalSec}
                      onChange={(e) => setEditFrameIntervalSec(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Client samples a frame every {editFrameIntervalSec}s. Lower = more aggressive, higher cost. Range {FRAME_INTERVAL_MIN}–{FRAME_INTERVAL_MAX}.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      Auto-bounce threshold (strikes)
                    </label>
                    <input
                      type="number"
                      min={AUTO_BOUNCE_MIN}
                      max={AUTO_BOUNCE_MAX}
                      value={editAutoBounceThreshold}
                      onChange={(e) => setEditAutoBounceThreshold(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      User is kicked after {editAutoBounceThreshold} flagged frames. Range {AUTO_BOUNCE_MIN}–{AUTO_BOUNCE_MAX}.
                    </p>
                  </div>
                </div>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Disallowed Items
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {editItems.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs"
                    >
                      {item}
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item)}
                        className="text-blue-600 dark:text-blue-300 hover:text-blue-900"
                        aria-label={`Remove ${item}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newItemDraft}
                    onChange={(e) => setNewItemDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
                    placeholder="Add item..."
                    className="flex-1 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-300"
                  >
                    Add
                  </button>
                </div>

                <div className="flex gap-2 mb-6">
                  <button
                    type="button"
                    onClick={handleSaveVersion}
                    disabled={saving}
                    className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save as new version'}
                  </button>
                  <label className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-sm font-medium text-gray-800 dark:text-gray-100 cursor-pointer hover:bg-gray-300">
                    {testing ? 'Testing...' : 'Test with image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      disabled={testing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleTestUpload(file);
                      }}
                    />
                  </label>
                </div>

                {classification && (
                  <div className="mb-6 p-3 rounded-md bg-gray-100 dark:bg-gray-900 text-xs font-mono overflow-x-auto">
                    <div
                      className={`inline-block mb-2 px-2 py-0.5 rounded text-white text-xs font-semibold ${
                        classification.flagged ? 'bg-red-600' : 'bg-green-600'
                      }`}
                    >
                      {classification.flagged ? 'FLAGGED' : 'OK'} — {(classification.confidence * 100).toFixed(1)}%
                    </div>
                    <pre className="text-gray-800 dark:text-gray-100">
                      {JSON.stringify(classification, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Version history */}
                {detail.versions.length > 1 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                      Version history
                    </h3>
                    <ul className="space-y-1">
                      {detail.versions.slice().reverse().map((v) => (
                        <li
                          key={v.version}
                          className="flex items-center justify-between px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm"
                        >
                          <span className="text-gray-700 dark:text-gray-200">
                            v{v.version} — {v.severity} — {v.disallowedItems.length} items
                            <span className="text-xs text-gray-500 ml-2">
                              by {v.createdBy} at {new Date(v.createdAt).toLocaleString()}
                            </span>
                          </span>
                          {v.version === detail.activeVersion ? (
                            <span className="text-xs text-green-600 font-semibold">active</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRollback(v.version)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Rollback
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
