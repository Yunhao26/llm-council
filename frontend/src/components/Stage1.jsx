import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { estimateTokens, formatTokenCount } from '../utils/tokenEstimate';
import './Stage1.css';

function formatLatencyMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)} ms`;
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
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);

  if (!responses || responses.length === 0) {
    return null;
  }

  const canCompare = responses.length >= 2;

  // Keep indices in-bounds if response count changes (e.g. different conversation loaded).
  useEffect(() => {
    setActiveTab((t) => clampIndex(t, responses.length));
    setLeftIndex((i) => clampIndex(i, responses.length));
    setRightIndex((i) => clampIndex(i, responses.length));
  }, [responses.length]);

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

  const toggleCompare = () => {
    if (!canCompare) return;

    setCompareMode((prev) => {
      const next = !prev;
      if (next) {
        setLeftIndex(activeTab);
        setRightIndex(nextDifferentIndex(activeTab, responses.length));
      } else {
        setActiveTab(leftIndex);
      }
      return next;
    });
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
    const tokens = estimateTokens(resp.response);
    const tokensText = `~${formatTokenCount(tokens)} tok`;

    return (
      <div className="tab-content">
        <div className="model-name">
          <div>{resp.model}</div>
          {resp.ollama_model && <div>Ollama: {resp.ollama_model}</div>}
          {respLatency && <div>Latency: {respLatency}</div>}
          <div>Est. tokens: {tokensText}</div>
        </div>
        <div className="response-text markdown-content">
          <ReactMarkdown>{resp.response}</ReactMarkdown>
        </div>
      </div>
    );
  };

  return (
    <div className="stage stage1">
      <div className={`stage1-header ${showTitle ? '' : 'no-title'}`.trim()}>
        {showTitle && <h3 className="stage-title">Stage 1: Individual Responses</h3>}
        <div className="stage1-actions">
          <button
            type="button"
            className="stage1-action-btn"
            onClick={toggleCompare}
            disabled={!canCompare}
            title={canCompare ? 'Compare two models side by side' : 'Need at least 2 responses to compare'}
          >
            {compareMode ? 'Single view' : 'Compare'}
          </button>
        </div>
      </div>

      {compareMode ? (
        <>
          <div className="stage1-compare-controls">
            <span className="stage1-compare-label">Left</span>
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

            <span className="stage1-compare-label">Right</span>
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

          <div className="stage1-compare-grid">
            {renderResponse(left, leftLatency)}
            {renderResponse(right, rightLatency)}
          </div>
        </>
      ) : (
        <>
          <div className="tabs">
            {responses.map((resp, index) => (
              <button
                key={index}
                className={`tab ${activeTab === index ? 'active' : ''}`}
                onClick={() => setActiveTab(index)}
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
