import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { resolveTokenCount, formatTokenDisplay } from '../utils/tokenEstimate';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = model.split('/')[1] || model;
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

function formatLatencyMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)} ms`;
}

function shortName(model) {
  const s = String(model ?? '');
  return s.split('/')[1] || s || 'Unknown';
}

function labelToDisplay(label, labelToModel) {
  if (labelToModel && labelToModel[label]) {
    return shortName(labelToModel[label]);
  }
  return String(label ?? '');
}

function clampIndex(index, length) {
  const n = Number(index);
  if (!Number.isFinite(n)) return 0;
  if (length <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(n)), length - 1);
}

function extractEvaluationText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return '';

  const scoresHdr = s.match(/SCORES\s*:/i);
  if (scoresHdr && typeof scoresHdr.index === 'number') {
    return s.slice(0, scoresHdr.index).trim();
  }

  // Some models omit "SCORES:" and start directly with score lines.
  const firstScoreLine = s.match(/Response\s+[A-Z]\s*\|\s*accuracy\s*[:=]/i);
  if (firstScoreLine && typeof firstScoreLine.index === 'number') {
    return s.slice(0, firstScoreLine.index).trim();
  }

  const finalHdr = s.match(/FINAL\s+RANKING\s*:/i);
  if (finalHdr && typeof finalHdr.index === 'number') {
    return s.slice(0, finalHdr.index).trim();
  }

  return s.trim();
}

function ScoreTable({ title, subtitle, labels, scores, labelToModel, rankByLabel }) {
  const rows = Array.isArray(labels) && labels.length > 0 ? labels : Object.keys(scores || {});
  if (!rows || rows.length === 0) return null;

  return (
    <div className="scores-panel">
      <div className="scores-panel-title">{title}</div>
      {subtitle ? <div className="scores-panel-subtitle">{subtitle}</div> : null}

      <div className="scores-table-wrap">
        <table className="scores-table">
          <thead>
            <tr>
              <th>Response</th>
              <th>Rank</th>
              <th>Accuracy</th>
              <th>Insight</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((label) => {
              const s = scores?.[label];
              const acc = s?.accuracy;
              const ins = s?.insight;
              const tot = s?.total;
              const ok = s?.total_ok !== false;
              const warn = ok ? null : 'total mismatch';
              const rank = rankByLabel?.[label];

              return (
                <tr key={label}>
                  <td className="scores-model" title={String(label)}>
                    {labelToDisplay(label, labelToModel)}
                  </td>
                  <td className="scores-rank">{Number.isFinite(Number(rank)) ? rank : '—'}</td>
                  <td className="scores-num">{Number.isFinite(Number(acc)) ? acc : '—'}</td>
                  <td className="scores-num">{Number.isFinite(Number(ins)) ? ins : '—'}</td>
                  <td className="scores-num" title={warn || ''}>
                    {Number.isFinite(Number(tot)) ? tot : '—'}
                    {!ok ? <span className="scores-warn"> {warn}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Stage2({
  rankings,
  labelToModel,
  aggregateRankings,
  aggregateScores,
  showTitle = true,
}) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  useEffect(() => {
    setActiveTab((t) => clampIndex(t, rankings.length));
  }, [rankings.length]);

  const active = rankings[activeTab] || {};
  const latency = formatLatencyMs(active.latency_ms);
  const { count: tokens, isEstimate } = resolveTokenCount(active.ranking, active, {
    prefer: 'completion',
  });
  const tokensText = formatTokenDisplay(tokens, isEstimate);
  const excludedLabel = active.excluded_label;
  const excludedText = excludedLabel ? labelToDisplay(excludedLabel, labelToModel) : null;

  const reviewedLabels = useMemo(() => {
    const list = active.reviewed_labels;
    return Array.isArray(list) ? list : null;
  }, [active.reviewed_labels]);

  const extractedRanking = useMemo(() => {
    const list = active.parsed_ranking;
    return Array.isArray(list) && list.length > 0 ? list : null;
  }, [active.parsed_ranking]);

  const rankByLabel = useMemo(() => {
    const m = {};
    if (!Array.isArray(extractedRanking)) return m;
    for (let i = 0; i < extractedRanking.length; i += 1) {
      const label = extractedRanking[i];
      if (label != null) m[String(label)] = i + 1;
    }
    return m;
  }, [extractedRanking]);

  const parsedScores = useMemo(() => {
    const s = active.parsed_scores;
    if (!s || typeof s !== 'object') return null;
    const keys = Object.keys(s);
    if (keys.length === 0) return null;
    return s;
  }, [active.parsed_scores]);

  const tableLabels = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (x) => {
      const v = String(x ?? '');
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    };

    if (Array.isArray(extractedRanking)) {
      extractedRanking.forEach(add);
    }
    if (Array.isArray(reviewedLabels)) {
      reviewedLabels.forEach(add);
    } else if (parsedScores) {
      Object.keys(parsedScores).forEach(add);
    }
    return out;
  }, [extractedRanking, reviewedLabels, parsedScores]);

  const evaluationText = useMemo(() => extractEvaluationText(active.ranking), [active.ranking]);
  const hasEvaluation = Boolean(evaluationText && evaluationText.trim().length > 0);

  const aggregateScoreByModel = useMemo(() => {
    const m = new Map();
    if (!Array.isArray(aggregateScores)) return m;
    for (const x of aggregateScores) {
      if (x && typeof x === 'object' && x.model) {
        m.set(x.model, x);
      }
    }
    return m;
  }, [aggregateScores]);

  const aggregateScoresView = useMemo(() => {
    if (!Array.isArray(aggregateScores) || aggregateScores.length === 0) return null;

    const list = [...aggregateScores];
    list.sort((a, b) => {
      const at = Number(a?.average_total);
      const bt = Number(b?.average_total);
      const atOk = Number.isFinite(at);
      const btOk = Number.isFinite(bt);
      if (atOk && btOk && at !== bt) return bt - at;
      if (atOk && !btOk) return -1;
      if (!atOk && btOk) return 1;

      const aa = Number(a?.average_accuracy);
      const ba = Number(b?.average_accuracy);
      const aaOk = Number.isFinite(aa);
      const baOk = Number.isFinite(ba);
      if (aaOk && baOk && aa !== ba) return ba - aa;
      if (aaOk && !baOk) return -1;
      if (!aaOk && baOk) return 1;

      const ai = Number(a?.average_insight);
      const bi = Number(b?.average_insight);
      const aiOk = Number.isFinite(ai);
      const biOk = Number.isFinite(bi);
      if (aiOk && biOk && ai !== bi) return bi - ai;
      if (aiOk && !biOk) return -1;
      if (!aiOk && biOk) return 1;

      return String(a?.model ?? '').localeCompare(String(b?.model ?? ''));
    });

    const eps = 1e-6;
    let lastKey = null;
    let lastRank = 0;
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const x = list[i] || {};
      const key = [
        Number(x.average_total),
        Number(x.average_accuracy),
        Number(x.average_insight),
      ];
      const tie =
        Array.isArray(lastKey) &&
        key.length === lastKey.length &&
        key.every((v, idx) => Number.isFinite(v) && Number.isFinite(lastKey[idx]) && Math.abs(v - lastKey[idx]) <= eps);
      const rank = tie ? lastRank : i + 1;
      if (!tie) lastRank = rank;
      lastKey = key;
      out.push({ ...x, __rank: rank, __tie: tie });
    }
    return out;
  }, [aggregateScores]);

  const aggregateRankingsView = useMemo(() => {
    if (!Array.isArray(aggregateRankings) || aggregateRankings.length === 0) return null;

    const list = [...aggregateRankings];
    list.sort((a, b) => {
      const ar = Number(a?.average_rank);
      const br = Number(b?.average_rank);
      const arOk = Number.isFinite(ar);
      const brOk = Number.isFinite(br);
      if (arOk && brOk && ar !== br) return ar - br;
      if (arOk && !brOk) return -1;
      if (!arOk && brOk) return 1;

      // Tie-breaker: prefer higher aggregate score to avoid misleading ordering (esp. when avg ranks are tied).
      const as = aggregateScoreByModel.get(a?.model);
      const bs = aggregateScoreByModel.get(b?.model);
      const at = Number(as?.average_total);
      const bt = Number(bs?.average_total);
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
      const aa = Number(as?.average_accuracy);
      const ba = Number(bs?.average_accuracy);
      if (Number.isFinite(aa) && Number.isFinite(ba) && aa !== ba) return ba - aa;
      const ai = Number(as?.average_insight);
      const bi = Number(bs?.average_insight);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;

      return String(a?.model ?? '').localeCompare(String(b?.model ?? ''));
    });

    const eps = 1e-6;
    let lastAvg = null;
    let lastRank = 0;
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i] || {};
      const avg = Number(item.average_rank);
      const tie =
        i > 0 && Number.isFinite(avg) && Number.isFinite(lastAvg) && Math.abs(avg - lastAvg) <= eps;
      const rank = tie ? lastRank : i + 1;
      if (!tie) lastRank = rank;
      lastAvg = avg;
      out.push({ ...item, __rank: rank, __tie: tie });
    }

    const allSame =
      out.length > 1 &&
      out.every((x) => Number.isFinite(Number(x.average_rank))) &&
      out.every((x) => Math.abs(Number(x.average_rank) - Number(out[0].average_rank)) <= eps);

    return { items: out, allSame };
  }, [aggregateRankings, aggregateScoreByModel]);

  return (
    <div className="stage stage2">
      {showTitle && <h3 className="stage-title">Stage 2: Peer Rankings</h3>}

      <h4>Raw Evaluations</h4>
      <p className="stage-description">
        Each model reviews other models' answers anonymously (Response A, B, C, etc.).
        Rankings are based on <strong>accuracy</strong> and <strong>insight</strong>. For fairness, a model does <strong>not</strong> see its own Stage 1 answer during review.
        Below, model names are shown in <strong>bold</strong> for readability, but the original evaluation used anonymous labels.
      </p>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {rank.model.split('/')[1] || rank.model}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">
          <div>{active.model}</div>
          {active.ollama_model && <div>Ollama: {active.ollama_model}</div>}
          {latency && <div>Latency: {latency}</div>}
          <div>Tokens: {tokensText}</div>
          {excludedText ? <div>Excluded (self): {excludedText}</div> : null}
        </div>
        <div className="ranking-content markdown-content">
          {hasEvaluation ? (
            <ReactMarkdown>
              {deAnonymizeText(evaluationText, labelToModel)}
            </ReactMarkdown>
          ) : (
            <div className="scores-parse-warning">
              This reviewer did not provide an analysis section (only scores/ranking). See the full raw output below.
            </div>
          )}
        </div>

        {reviewedLabels && reviewedLabels.length > 0 && !parsedScores ? (
          <div className="scores-parse-warning">
            Could not extract numeric scores (format not strictly followed). The table below will show blanks. Expand “Full raw output” to inspect the original text.
          </div>
        ) : null}

        {tableLabels.length > 0 ? (
          <ScoreTable
            title="Scores + Ranking (merged)"
            subtitle="Rank is extracted from FINAL RANKING. Totals are computed as accuracy + insight (0–20)."
            labels={tableLabels}
            scores={parsedScores || {}}
            labelToModel={labelToModel}
            rankByLabel={rankByLabel}
          />
        ) : null}

        <details className="raw-output">
          <summary>Full raw output (including SCORES / FINAL RANKING)</summary>
          <div className="ranking-content markdown-content">
            <ReactMarkdown>
              {deAnonymizeText(active.ranking, labelToModel)}
            </ReactMarkdown>
          </div>
        </details>
      </div>

      {aggregateScores && aggregateScores.length > 0 && (
        <div className="aggregate-scores">
          <h4>Aggregate Scores (Accuracy + Insight)</h4>
          <p className="stage-description">
            Averaged across all peer evaluations (higher total is better):
          </p>
          <div className="aggregate-list">
            {(aggregateScoresView || aggregateScores).map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">
                  #{agg.__rank ?? index + 1}
                  {agg.__tie ? ' (tie)' : ''}
                </span>
                <span className="rank-model">{shortName(agg.model)}</span>
                <span className="rank-score">
                  Acc: {Number(agg.average_accuracy).toFixed(2)} • Ins: {Number(agg.average_insight).toFixed(2)} • Total:{' '}
                  {Number(agg.average_total).toFixed(2)}
                </span>
                <span className="rank-count">({agg.scores_count} votes)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-rankings">
          <h4>Aggregate Rankings (Street Cred)</h4>
          <p className="stage-description">
            Combined results across all peer evaluations (lower score is better):
          </p>
          {aggregateRankingsView?.allSame ? (
            <div className="scores-parse-warning">
              Note: all models have the same average rank (tie). This can happen when each reviewer only sees 1 response
              (e.g. 2-model setup with exclude-self). Use <strong>Aggregate Scores</strong> above for a meaningful winner.
            </div>
          ) : null}
          <div className="aggregate-list">
            {(aggregateRankingsView?.items || aggregateRankings).map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">
                  #{agg.__rank ?? index + 1}
                  {agg.__tie ? ' (tie)' : ''}
                </span>
                <span className="rank-model">
                  {agg.model.split('/')[1] || agg.model}
                </span>
                <span className="rank-score">
                  Avg: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">
                  ({agg.rankings_count} votes)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
