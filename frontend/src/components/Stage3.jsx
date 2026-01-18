import ReactMarkdown from 'react-markdown';
import { resolveTokenCount, formatTokenDisplay } from '../utils/tokenEstimate';
import './Stage3.css';

function formatLatencyMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)} ms`;
}

export default function Stage3({ finalResponse, showTitle = true }) {
  if (!finalResponse) {
    return null;
  }

  const latency = formatLatencyMs(finalResponse.latency_ms);
  const { count: tokens, isEstimate } = resolveTokenCount(finalResponse.response, finalResponse, {
    prefer: 'completion',
  });
  const tokensText = formatTokenDisplay(tokens, isEstimate);

  return (
    <div className="stage stage3">
      {showTitle && <h3 className="stage-title">Stage 3: Final Council Answer</h3>}
      <div className="final-response">
        <div className="chairman-label">
          Chairman: {finalResponse.model.split('/')[1] || finalResponse.model}
          {latency ? ` • Latency: ${latency}` : ''} • Tokens: {tokensText}
        </div>
        <div className="final-text markdown-content">
          <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
