import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import './WorkerStatusPanel.css';

function formatTime(d) {
  if (!d) return '';
  try {
    return d.toLocaleTimeString();
  } catch {
    return String(d);
  }
}

function computeWorkerState(worker) {
  const reachable = Boolean(worker?.reachable);
  const ollamaOk = worker?.health?.ollama_ok === true;

  if (!reachable) {
    return { key: 'unavailable', label: 'unavailable', dotClass: 'dot-red' };
  }
  if (!ollamaOk) {
    return { key: 'ollama_down', label: 'ollama down', dotClass: 'dot-yellow' };
  }
  return { key: 'running', label: 'running', dotClass: 'dot-green' };
}

function getDisplayModel(worker) {
  const model = worker?.health?.model;
  if (!model) return 'unknown';
  return String(model);
}

function WorkerRow({ worker }) {
  const state = computeWorkerState(worker);
  const model = getDisplayModel(worker);

  return (
    <div className={`worker-row ${state.key}`}>
      <span className={`status-dot ${state.dotClass}`} aria-hidden="true" />
      <div className="worker-main">
        <div className="worker-name" title={worker?.name || ''}>
          {worker?.name || 'Unknown worker'}
        </div>
        <div className="worker-model" title={model}>
          {model}
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

      <div className="worker-panel-body">
        <div className="worker-group">
          <div className="worker-group-title">Council</div>
          {council.length === 0 ? (
            <div className="worker-empty">No council workers configured</div>
          ) : (
            <div className="worker-list">
              {council.map((w, idx) => (
                <WorkerRow key={w?.name || `council-${idx}`} worker={w} />
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
                <WorkerRow key={w?.name || `chairman-${idx}`} worker={w} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

