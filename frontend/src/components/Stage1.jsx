import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { resolveTokenCount, formatTokenDisplay } from '../utils/tokenEstimate';
import { diffLines } from '../utils/textDiff';
import './Stage1.css';

const MODEL_ACCENT_COLORS = [
  '#4a90e2', // blue (primary)
  '#7e57c2', // purple
  '#26a69a', // teal
  '#ef5350', // red
  '#ffa726', // orange
  '#66bb6a', // green
  '#29b6f6', // light blue
  '#ab47bc', // magenta
  '#8d6e63', // brown
  '#5c6bc0', // indigo
];

function formatLatencyMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)} ms`;
}

function hashString(s) {
  const str = String(s ?? '');
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function accentForModel(modelName, fallbackIndex = 0) {
  const str = String(modelName ?? '').trim();
  const idx = str ? hashString(str) % MODEL_ACCENT_COLORS.length : fallbackIndex % MODEL_ACCENT_COLORS.length;
  return MODEL_ACCENT_COLORS[idx] || MODEL_ACCENT_COLORS[0];
}

function collapseEqualOps(ops, { context = 2, minCollapse = 12 } = {}) {
  const out = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type !== 'equal') {
      out.push(op);
      i += 1;
      continue;
    }

    let j = i;
    while (j < ops.length && ops[j].type === 'equal') {
      j += 1;
    }

    const runLen = j - i;
    if (runLen >= minCollapse && runLen > context * 2) {
      out.push(...ops.slice(i, i + context));
      out.push({ type: 'skip', count: runLen - context * 2 });
      out.push(...ops.slice(j - context, j));
    } else {
      out.push(...ops.slice(i, j));
    }

    i = j;
  }

  return out;
}

function nextDifferentIndex(index, length) {
  if (length <= 1) return 0;
  return index === 0 ? 1 : 0;
}

function clampIndex(index, length) {
  const n = Number(index);
  if (!Number.isFinite(n)) return 0;
  if (length <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(n)), length - 1);
}

export default function Stage1({ responses, showTitle = true }) {
  const [activeTab, setActiveTab] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);

  if (!responses || responses.length === 0) {
    return null;
  }

  const canCompare = responses.length >= 2;

  // If we can't compare (e.g. only 1 model responded), force-disable compare/diff UI.
  useEffect(() => {
    if (!canCompare) {
      setCompareMode(false);
      setDiffMode(false);
    }
  }, [canCompare]);

  // Keep indices in-bounds if response count changes (e.g. different conversation loaded).
  useEffect(() => {
    setActiveTab((t) => clampIndex(t, responses.length));
    setLeftIndex((i) => clampIndex(i, responses.length));
    setRightIndex((i) => clampIndex(i, responses.length));
  }, [responses.length]);

  // Ensure left/right are different while comparing (best-effort).
  useEffect(() => {
    if (!compareMode || !canCompare) return;
    if (leftIndex === rightIndex) {
      setRightIndex(nextDifferentIndex(leftIndex, responses.length));
    }
  }, [compareMode, canCompare, leftIndex, rightIndex, responses.length]);

  const active = useMemo(() => responses[activeTab] || {}, [responses, activeTab]);
  const latency = formatLatencyMs(active.latency_ms);

  const left = useMemo(() => responses[leftIndex] || {}, [responses, leftIndex]);
  const right = useMemo(() => responses[rightIndex] || {}, [responses, rightIndex]);
  const leftLatency = formatLatencyMs(left.latency_ms);
  const rightLatency = formatLatencyMs(right.latency_ms);

  const modelOptions = useMemo(() => {
    return responses.map((resp, idx) => {
      const label = resp.model?.split('/')?.[1] || resp.model || `Model ${idx + 1}`;
      return { value: idx, label };
    });
  }, [responses]);

  const enterCompare = ({ showDiff }) => {
    if (!canCompare) return;
    setCompareMode(true);
    setDiffMode(Boolean(showDiff));
    setLeftIndex(activeTab);
    setRightIndex(nextDifferentIndex(activeTab, responses.length));
  };

  const exitCompare = () => {
    setCompareMode(false);
    setDiffMode(false);
    setActiveTab(leftIndex);
  };

  const handleCompareClick = () => {
    if (!canCompare) return;
    if (compareMode) {
      exitCompare();
    } else {
      enterCompare({ showDiff: false });
    }
  };

  const handleDiffClick = () => {
    if (!canCompare) return;
    if (!compareMode) {
      enterCompare({ showDiff: true });
      return;
    }
    setDiffMode((prev) => !prev);
  };

  const handleLeftChange = (value) => {
    const nextLeft = clampIndex(value, responses.length);
    setLeftIndex(nextLeft);
    if (nextLeft === rightIndex) {
      setRightIndex(nextDifferentIndex(nextLeft, responses.length));
    }
  };

  const handleRightChange = (value) => {
    const nextRight = clampIndex(value, responses.length);
    setRightIndex(nextRight);
    if (nextRight === leftIndex) {
      setLeftIndex(nextDifferentIndex(nextRight, responses.length));
    }
  };

  const swapSides = () => {
    if (!canCompare) return;
    setLeftIndex(rightIndex);
    setRightIndex(leftIndex);
  };

  const renderResponse = (resp, respLatency) => {
    const { count: tokens, isEstimate } = resolveTokenCount(resp.response, resp, {
      prefer: 'completion',
    });
    const tokensText = formatTokenDisplay(tokens, isEstimate);
    const accent = accentForModel(resp.model);

    return (
      <div className="tab-content stage1-tab-content" style={{ '--model-accent': accent }}>
        <div className="model-name">
          <div>{resp.model}</div>
          {resp.ollama_model && <div>Ollama: {resp.ollama_model}</div>}
          {respLatency && <div>Latency: {respLatency}</div>}
          <div>Tokens: {tokensText}</div>
        </div>
        <div className="response-text markdown-content">
          <ReactMarkdown>{resp.response}</ReactMarkdown>
        </div>
      </div>
    );
  };

  const leftText = String(left?.response ?? '');
  const rightText = String(right?.response ?? '');
  const leftAccent = accentForModel(left?.model, leftIndex);
  const rightAccent = accentForModel(right?.model, rightIndex);

  const diffView = useMemo(() => {
    if (!compareMode || !diffMode) return null;

    const r = diffLines(leftText, rightText, { maxTotalLines: 800 });
    if (r.tooLarge) {
      return { ...r, opsCollapsed: [], adds: 0, dels: 0 };
    }

    let adds = 0;
    let dels = 0;
    for (const op of r.ops) {
      if (op.type === 'add') adds += 1;
      else if (op.type === 'del') dels += 1;
    }

    const opsCollapsed = collapseEqualOps(r.ops, { context: 2, minCollapse: 12 });
    return { ...r, opsCollapsed, adds, dels };
  }, [compareMode, diffMode, leftText, rightText]);

  return (
    <div className="stage stage1">
      <div className={`stage1-header ${showTitle ? '' : 'no-title'}`.trim()}>
        {showTitle && <h3 className="stage-title">Stage 1: Individual Responses</h3>}
        <div className="stage1-actions">
          <button
            type="button"
            className="stage1-action-btn"
            onClick={handleCompareClick}
            disabled={!canCompare}
            title={canCompare ? 'Compare two models side by side' : 'Need at least 2 responses to compare'}
          >
            {compareMode ? 'Single view' : 'Compare'}
          </button>
          <button
            type="button"
            className="stage1-action-btn"
            onClick={handleDiffClick}
            disabled={!canCompare}
            title={canCompare ? 'Show diff between two models' : 'Need at least 2 responses to diff'}
          >
            {compareMode && diffMode ? 'Hide diff' : 'Diff'}
          </button>
        </div>
      </div>

      {compareMode ? (
        <>
          <div className="stage1-compare-controls">
            <span className="stage1-compare-label">
              <span className="stage1-color-dot" style={{ background: leftAccent }} aria-hidden="true" />
              Left
            </span>
            <select
              className="stage1-compare-select"
              value={leftIndex}
              onChange={(e) => handleLeftChange(e.target.value)}
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="stage1-swap-btn"
              onClick={swapSides}
              disabled={!canCompare}
              title="Swap left/right"
            >
              Swap
            </button>

            <span className="stage1-compare-label">
              <span className="stage1-color-dot" style={{ background: rightAccent }} aria-hidden="true" />
              Right
            </span>
            <select
              className="stage1-compare-select"
              value={rightIndex}
              onChange={(e) => handleRightChange(e.target.value)}
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {diffMode ? (
            <div className="stage1-diff">
              <div className="stage1-diff-meta">
                <div className="stage1-diff-title">
                  Diff: <span className="stage1-diff-model">{left.model || 'Left'}</span> →{' '}
                  <span className="stage1-diff-model">{right.model || 'Right'}</span>
                </div>
                {diffView && !diffView.tooLarge && (
                  <div className="stage1-diff-stats">
                    +{diffView.adds} -{diffView.dels} • {diffView.oldLineCount}→{diffView.newLineCount} lines
                  </div>
                )}
              </div>

              {diffView && diffView.tooLarge ? (
                <div className="stage1-diff-warning">
                  Diff disabled for large outputs ({diffView.oldLineCount + diffView.newLineCount} lines). Use side-by-side compare instead.
                </div>
              ) : (
                <div className="stage1-diff-code" role="textbox" aria-readonly="true">
                  {(diffView?.opsCollapsed || []).map((op, idx) => {
                    if (op.type === 'skip') {
                      return (
                        <div key={`skip-${idx}`} className="diff-line diff-skip">
                          <span className="diff-prefix">…</span>
                          <span className="diff-content">… {op.count} unchanged lines …</span>
                        </div>
                      );
                    }

                    const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
                    const cls =
                      op.type === 'add' ? 'diff-add' : op.type === 'del' ? 'diff-del' : 'diff-equal';

                    return (
                      <div key={idx} className={`diff-line ${cls}`}>
                        <span className="diff-prefix">{prefix}</span>
                        <span className="diff-content">{op.line}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="stage1-compare-grid" role="region" aria-label="Side by side comparison">
              {renderResponse(left, leftLatency)}
              {renderResponse(right, rightLatency)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="tabs">
            {responses.map((resp, index) => (
              <button
                key={index}
                  className={`tab stage1-tab ${activeTab === index ? 'active' : ''}`}
                onClick={() => setActiveTab(index)}
                  style={{ '--model-accent': accentForModel(resp.model, index) }}
              >
                {resp.model.split('/')[1] || resp.model}
              </button>
            ))}
          </div>

          {renderResponse(active, latency)}
        </>
      )}
    </div>
  );
}
