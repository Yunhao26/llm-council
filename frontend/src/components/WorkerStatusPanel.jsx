import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import './WorkerStatusPanel.css';

const OFFLINE_AFTER_MULTIPLIER = 3; // offline threshold = pollIntervalMs * multiplier

function formatTime(d) {
  if (!d) return '';
  try {
    return d.toLocaleTimeString();
  } catch {
    return String(d);
  }
}

function formatAgeMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return '0s';
  if (n < 60_000) return `${Math.floor(n / 1000)}s`;
  if (n < 3_600_000) return `${Math.floor(n / 60_000)}m`;
  if (n < 86_400_000) return `${Math.floor(n / 3_600_000)}h`;
  return `${Math.floor(n / 86_400_000)}d`;
}

function workerKey(worker) {
  const name = worker?.name ? String(worker.name) : '';
  const url = worker?.url ? String(worker.url) : '';
  return `${name}|${url}`;
}

function initHeartbeat({ nowMs }) {
  return {
    lastCheckMs: nowMs,
    lastSeenMs: null,
    lastModelOkMs: null,
    consecutiveFailures: 0,
    consecutiveModelFailures: 0,
  };
}

function getActiveRequests(worker) {
  const n = Number(worker?.health?.active_requests);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.trunc(n));
}

function computeWorkerState(worker, heartbeat, offlineAfterMs) {
  const reachable = Boolean(worker?.reachable);
  const ollamaOk = worker?.health?.ollama_ok === true;
  const active = getActiveRequests(worker);
  const busy = worker?.health?.busy === true || active > 0;
  const nowMs = Date.now();
  const lastSeenMs = heartbeat?.lastSeenMs;
  const lastModelOkMs = heartbeat?.lastModelOkMs;
  const offlineMs = Number(offlineAfterMs);

  if (!reachable) {
    const isOffline =
      Number.isFinite(offlineMs) && offlineMs > 0 && Number.isFinite(lastSeenMs) && lastSeenMs
        ? nowMs - lastSeenMs > offlineMs
        : false;
    return { key: 'unavailable', label: isOffline ? 'offline' : 'unreachable', dotClass: 'dot-red' };
  }
  if (!ollamaOk) {
    const isModelOffline =
      Number.isFinite(offlineMs) && offlineMs > 0 && Number.isFinite(lastModelOkMs) && lastModelOkMs
        ? nowMs - lastModelOkMs > offlineMs
        : false;
    return {
      key: 'ollama_down',
      label: isModelOffline ? 'model offline' : 'ollama down',
      dotClass: 'dot-yellow',
    };
  }
  if (busy) {
    const label = active > 0 ? `busy (${active})` : 'busy';
    return { key: 'busy', label, dotClass: 'dot-blue' };
  }
  return { key: 'idle', label: 'idle', dotClass: 'dot-green' };
}

function getDisplayModel(worker) {
  const model = worker?.health?.model;
  if (!model) return 'unknown';
  return String(model);
}

function WorkerRow({ worker, heartbeat, offlineAfterMs }) {
  const state = computeWorkerState(worker, heartbeat, offlineAfterMs);
  const model = getDisplayModel(worker);
  const active = getActiveRequests(worker);
  const nowMs = Date.now();
  const hb = heartbeat || {};
  const checkAge = hb.lastCheckMs ? `${formatAgeMs(nowMs - hb.lastCheckMs)} ago` : '—';
  const seenAge = hb.lastSeenMs ? `${formatAgeMs(nowMs - hb.lastSeenMs)} ago` : 'never';
  const modelOkAge = hb.lastModelOkMs ? `${formatAgeMs(nowMs - hb.lastModelOkMs)} ago` : 'never';

  const metaParts = [`check ${checkAge}`, `seen ${seenAge}`];
  if (state.key === 'unavailable') {
    metaParts.push(`fails ${hb.consecutiveFailures ?? 0}`);
  }
  if (state.key === 'ollama_down') {
    metaParts.push(`model ok ${modelOkAge}`);
    metaParts.push(`model fails ${hb.consecutiveModelFailures ?? 0}`);
  }
  const metaText = metaParts.join(' • ');

  return (
    <div className={`worker-row ${state.key}`}>
      <span className={`status-dot ${state.dotClass}`} aria-hidden="true" />
      <div className="worker-main">
        <div className="worker-name" title={worker?.name || ''}>
          {worker?.name || 'Unknown worker'}
        </div>
        <div className="worker-model" title={model}>
          {model}
          {active > 0 ? ` • in-flight ${active}` : ''}
        </div>
        <div className="worker-submeta" title={metaText}>
          {metaText}
        </div>
      </div>
      <div className="worker-status" title={state.label}>
        {state.label}
      </div>
    </div>
  );
}

export default function WorkerStatusPanel({ pollIntervalMs = 5000 }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [heartbeats, setHeartbeats] = useState({});

  const offlineAfterMs = Math.max(1000, Number(pollIntervalMs) * OFFLINE_AFTER_MULTIPLIER);

  const fetchHealth = async ({ isManual = false } = {}) => {
    try {
      if (health) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      if (isManual) setError(null);

      const data = await api.getWorkersHealth();
      setHealth(data);
      setHeartbeats((prev) => {
        const nowMs = Date.now();
        const next = { ...(prev || {}) };

        const all = [];
        if (Array.isArray(data?.council)) all.push(...data.council);
        if (data?.chairman && typeof data.chairman === 'object') all.push(data.chairman);

        const seenKeys = new Set();
        for (const w of all) {
          const key = workerKey(w);
          seenKeys.add(key);
          const prevHb = next[key] || initHeartbeat({ nowMs });
          const hb = { ...prevHb, lastCheckMs: nowMs };

          const reachable = Boolean(w?.reachable);
          const modelOk = reachable && w?.health?.ollama_ok === true;

          if (reachable) {
            hb.lastSeenMs = nowMs;
            hb.consecutiveFailures = 0;
          } else {
            hb.consecutiveFailures = Number(prevHb.consecutiveFailures || 0) + 1;
          }

          if (modelOk) {
            hb.lastModelOkMs = nowMs;
            hb.consecutiveModelFailures = 0;
          } else {
            hb.consecutiveModelFailures = Number(prevHb.consecutiveModelFailures || 0) + 1;
          }

          next[key] = hb;
        }

        // Prune heartbeat entries if topology changes
        for (const k of Object.keys(next)) {
          if (!seenKeys.has(k)) delete next[k];
        }

        return next;
      });
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load worker health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const safeFetch = async () => {
      if (cancelled) return;
      await fetchHealth();
    };

    safeFetch();
    const timer = setInterval(safeFetch, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs]);

  const council = useMemo(() => {
    const list = health?.council;
    return Array.isArray(list) ? list : [];
  }, [health]);

  const chairman = useMemo(() => {
    const c = health?.chairman;
    return c && typeof c === 'object' ? [c] : [];
  }, [health]);

  return (
    <div className="worker-status-panel">
      <div className="worker-panel-header">
        <div className="worker-panel-title">Model Status</div>
        <div className="worker-panel-actions">
          <button
            type="button"
            className="worker-refresh-btn"
            onClick={() => fetchHealth({ isManual: true })}
            disabled={loading || refreshing}
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="worker-panel-meta">
        <div>
          {loading ? (
            <span>Loading...</span>
          ) : error ? (
            <span className="worker-error">Error: {error}</span>
          ) : (
            <span>
              Last updated: {formatTime(lastUpdated)}
              {refreshing ? ' (updating...)' : ''}
            </span>
          )}
        </div>
        <div className="worker-panel-threshold">
          Offline threshold: {Math.round(offlineAfterMs / 1000)}s ({OFFLINE_AFTER_MULTIPLIER}× interval)
        </div>
      </div>

      <div className="worker-panel-body">
        <div className="worker-group">
          <div className="worker-group-title">Council</div>
          {council.length === 0 ? (
            <div className="worker-empty">No council workers configured</div>
          ) : (
            <div className="worker-list">
              {council.map((w, idx) => (
                <WorkerRow
                  key={w?.name || `council-${idx}`}
                  worker={w}
                  heartbeat={heartbeats[workerKey(w)]}
                  offlineAfterMs={offlineAfterMs}
                />
              ))}
            </div>
          )}
        </div>

        <div className="worker-group">
          <div className="worker-group-title">Chairman</div>
          {chairman.length === 0 ? (
            <div className="worker-empty">No chairman configured</div>
          ) : (
            <div className="worker-list">
              {chairman.map((w, idx) => (
                <WorkerRow
                  key={w?.name || `chairman-${idx}`}
                  worker={w}
                  heartbeat={heartbeats[workerKey(w)]}
                  offlineAfterMs={offlineAfterMs}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

