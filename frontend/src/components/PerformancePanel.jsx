import { useMemo } from 'react';
import './PerformancePanel.css';

function shortName(name) {
  const s = String(name ?? '');
  return s.split('/')[1] || s || 'Unknown';
}

function createAgg() {
  return { count: 0, sum: 0, min: Infinity, max: -Infinity };
}

function addAgg(agg, ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return;
  agg.count += 1;
  agg.sum += n;
  agg.min = Math.min(agg.min, n);
  agg.max = Math.max(agg.max, n);
}

function finalizeAgg(agg) {
  if (!agg || agg.count <= 0) return null;
  return {
    count: agg.count,
    avg: agg.sum / agg.count,
    min: agg.min,
    max: agg.max,
  };
}

function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)} ms`;
}

function formatRange(min, max) {
  const a = Number(min);
  const b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  return `${Math.round(a)}–${Math.round(b)} ms`;
}

function computePerformance(messages) {
  const byModel = new Map();

  const ensure = (model) => {
    const key = String(model ?? 'Unknown');
    if (byModel.has(key)) return byModel.get(key);
    const entry = {
      model: key,
      stage1: createAgg(),
      stage2: createAgg(),
      stage3: createAgg(),
      total: createAgg(),
    };
    byModel.set(key, entry);
    return entry;
  };

  const msgs = Array.isArray(messages) ? messages : [];
  for (const msg of msgs) {
    if (!msg || msg.role !== 'assistant') continue;

    if (Array.isArray(msg.stage1)) {
      for (const r of msg.stage1) {
        const entry = ensure(r?.model);
        addAgg(entry.stage1, r?.latency_ms);
        addAgg(entry.total, r?.latency_ms);
      }
    }

    if (Array.isArray(msg.stage2)) {
      for (const r of msg.stage2) {
        const entry = ensure(r?.model);
        addAgg(entry.stage2, r?.latency_ms);
        addAgg(entry.total, r?.latency_ms);
      }
    }

    if (msg.stage3 && typeof msg.stage3 === 'object') {
      const entry = ensure(msg.stage3?.model);
      addAgg(entry.stage3, msg.stage3?.latency_ms);
      addAgg(entry.total, msg.stage3?.latency_ms);
    }
  }

  const rows = [];
  let totalCalls = 0;
  for (const entry of byModel.values()) {
    const stage1 = finalizeAgg(entry.stage1);
    const stage2 = finalizeAgg(entry.stage2);
    const stage3 = finalizeAgg(entry.stage3);
    const total = finalizeAgg(entry.total);

    const calls = (stage1?.count || 0) + (stage2?.count || 0) + (stage3?.count || 0);
    if (calls <= 0) continue;

    totalCalls += calls;
    rows.push({
      model: entry.model,
      display: shortName(entry.model),
      stage1,
      stage2,
      stage3,
      total,
      calls,
    });
  }

  rows.sort((a, b) => {
    const aa = a.total?.avg;
    const bb = b.total?.avg;
    if (aa == null && bb == null) return a.model.localeCompare(b.model);
    if (aa == null) return 1;
    if (bb == null) return -1;
    return aa - bb;
  });

  return {
    rows,
    totalCalls,
    modelCount: rows.length,
  };
}

function Cell({ agg }) {
  if (!agg) return <span className="perf-empty">—</span>;
  const range = formatRange(agg.min, agg.max);
  return (
    <div className="perf-cell" title={range ? `range ${range}` : ''}>
      <div className="perf-ms">{formatMs(agg.avg)}</div>
      <div className="perf-sub">
        <span className="perf-count">{agg.count}×</span>
        {range ? <span className="perf-range">{range}</span> : null}
      </div>
    </div>
  );
}

export default function PerformancePanel({ messages }) {
  const perf = useMemo(() => computePerformance(messages), [messages]);

  if (!perf || perf.rows.length === 0) {
    return null;
  }

  return (
    <div className="perf-panel">
      <div className="perf-header">
        <div className="perf-title">Latency summary (this conversation)</div>
        <div className="perf-meta">
          {perf.modelCount} models • {perf.totalCalls} calls
        </div>
      </div>

      <div className="perf-table-wrap">
        <table className="perf-table">
          <thead>
            <tr>
              <th className="perf-col-model">Model</th>
              <th>Stage 1</th>
              <th>Stage 2</th>
              <th>Stage 3</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {perf.rows.map((row) => (
              <tr key={row.model}>
                <td className="perf-model" title={row.model}>
                  {row.display}
                </td>
                <td>
                  <Cell agg={row.stage1} />
                </td>
                <td>
                  <Cell agg={row.stage2} />
                </td>
                <td>
                  <Cell agg={row.stage3} />
                </td>
                <td>
                  <Cell agg={row.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="perf-note">
        Based on recorded <code>latency_ms</code> from worker responses (includes inference + network overhead).
      </div>
    </div>
  );
}

