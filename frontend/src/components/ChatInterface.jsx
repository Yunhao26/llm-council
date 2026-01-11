import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import PerformancePanel from './PerformancePanel';
import StageStepper from './StageStepper';
import { estimateTokens, formatTokenCount } from '../utils/tokenEstimate';
import './ChatInterface.css';

function getStageStatus({ loading, hasData }) {
  if (loading) return 'running…';
  if (hasData) return 'done';
  return 'not started';
}

function getStageStepState({ loading, hasData, hasError }) {
  if (loading) return 'running';
  if (hasData) return 'done';
  if (hasError) return 'error';
  return 'not_started';
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const [panelOpen, setPanelOpen] = useState({});

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  // Reset per-stage panel state when switching conversations
  useEffect(() => {
    setPanelOpen({});
  }, [conversation?.id]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  const getPanelKey = (messageIndex, stage) => `${conversation.id}:${messageIndex}:${stage}`;

  const perfSummary = (() => {
    const msgs = Array.isArray(conversation.messages) ? conversation.messages : [];
    const models = new Set();
    let calls = 0;

    for (const msg of msgs) {
      if (!msg || msg.role !== 'assistant') continue;

      if (Array.isArray(msg.stage1)) {
        calls += msg.stage1.length;
        for (const r of msg.stage1) {
          if (r?.model) models.add(String(r.model));
        }
      }
      if (Array.isArray(msg.stage2)) {
        calls += msg.stage2.length;
        for (const r of msg.stage2) {
          if (r?.model) models.add(String(r.model));
        }
      }
      if (msg.stage3 && typeof msg.stage3 === 'object') {
        calls += 1;
        if (msg.stage3?.model) models.add(String(msg.stage3.model));
      }
    }

    return {
      hasData: calls > 0,
      calls,
      modelsCount: models.size,
    };
  })();

  const renderStagePanel = ({
    messageIndex,
    stage,
    title,
    defaultOpen = false,
    loading,
    hasData,
    metaExtra,
    summaryClassName = '',
    children,
  }) => {
    const key = getPanelKey(messageIndex, stage);
    const open = typeof panelOpen[key] === 'boolean' ? panelOpen[key] : defaultOpen;
    const status = getStageStatus({ loading, hasData });
    const meta = metaExtra ? `${status} • ${metaExtra}` : status;

    return (
      <details
        className={`stage-collapsible ${summaryClassName}`.trim()}
        open={open}
        onToggle={(e) => {
          const isOpen = e.currentTarget.open;
          setPanelOpen((prev) => ({ ...prev, [key]: isOpen }));
        }}
      >
        <summary className={`stage-summary ${summaryClassName}`.trim()}>
          <span className="stage-summary-title">{title}</span>
          <span className="stage-summary-meta">{meta}</span>
        </summary>
        <div className="stage-collapsible-body">
          {children}
        </div>
      </details>
    );
  };

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          <>
            {perfSummary.hasData &&
              renderStagePanel({
                messageIndex: 'conversation',
                stage: 'performance',
                title: 'Performance: Latency Summary',
                defaultOpen: false,
                loading: false,
                hasData: true,
                metaExtra: `${perfSummary.modelsCount} models • ${perfSummary.calls} calls`,
                summaryClassName: 'performance',
                children: <PerformancePanel messages={conversation.messages} />,
              })}

            {conversation.messages.map((msg, index) => (
              <div key={index} className="message-group">
                {msg.role === 'user' ? (
                  <div className="user-message">
                    <div className="message-label">You</div>
                    <div className="message-content">
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : (
                  (() => {
                    const fmt = (n) => `~${formatTokenCount(n)} tok`;

                    const prev = conversation.messages[index - 1];
                    const userText = prev && prev.role === 'user' ? prev.content : '';
                    const userTokens = estimateTokens(userText);

                    const stage1 = Array.isArray(msg.stage1) ? msg.stage1 : [];
                    const stage2 = Array.isArray(msg.stage2) ? msg.stage2 : [];
                    const stage3Text = msg.stage3?.response;
                  const errorMessage = msg.error ? String(msg.error) : null;

                    const stage1ByModel = stage1
                      .map((r) => ({
                        model: r?.model || 'Unknown',
                        tokens: estimateTokens(r?.response),
                      }))
                      .sort((a, b) => b.tokens - a.tokens);
                    const stage1Tokens = stage1ByModel.reduce((sum, x) => sum + x.tokens, 0);

                    const stage2ByModel = stage2
                      .map((r) => ({
                        model: r?.model || 'Unknown',
                        tokens: estimateTokens(r?.ranking),
                      }))
                      .sort((a, b) => b.tokens - a.tokens);
                    const stage2Tokens = stage2ByModel.reduce((sum, x) => sum + x.tokens, 0);

                    const stage3Tokens = estimateTokens(stage3Text);

                    const totalTokens = userTokens + stage1Tokens + stage2Tokens + stage3Tokens;

                    const stage1Meta =
                      stage1.length > 0 ? `${stage1.length} responses • ${fmt(stage1Tokens)}` : null;
                    const stage2Meta =
                      stage2.length > 0 ? `${stage2.length} reviews • ${fmt(stage2Tokens)}` : null;

                    const stage3MetaParts = [];
                    if (msg.stage3?.latency_ms != null) {
                      const n = Number(msg.stage3.latency_ms);
                      if (Number.isFinite(n)) stage3MetaParts.push(`latency ${Math.round(n)} ms`);
                    }
                    if (msg.stage3?.response != null) {
                      stage3MetaParts.push(fmt(stage3Tokens));
                    }
                    const stage3Meta = stage3MetaParts.length > 0 ? stage3MetaParts.join(' • ') : null;

                    const anyLoading = Boolean(
                      msg.loading?.stage1 || msg.loading?.stage2 || msg.loading?.stage3
                    );
                    const anyData = Boolean(userText || stage1.length || stage2.length || msg.stage3);

                  const stage1State = getStageStepState({
                    loading: Boolean(msg.loading?.stage1),
                    hasData: stage1.length > 0,
                    hasError: Boolean(errorMessage) && stage1.length === 0,
                  });
                  const stage2State = getStageStepState({
                    loading: Boolean(msg.loading?.stage2),
                    hasData: stage2.length > 0,
                    hasError: Boolean(errorMessage) && stage2.length === 0,
                  });
                  const stage3State = getStageStepState({
                    loading: Boolean(msg.loading?.stage3),
                    hasData: Boolean(msg.stage3),
                    hasError: Boolean(errorMessage) && !msg.stage3,
                  });

                    return (
                      <div className="assistant-message">
                        <div className="message-label">LLM Council</div>

                      <StageStepper
                        stage1={stage1State}
                        stage2={stage2State}
                        stage3={stage3State}
                        errorMessage={errorMessage}
                      />

                        {renderStagePanel({
                          messageIndex: index,
                          stage: 'stage1',
                          title: 'Stage 1: Individual Responses',
                          defaultOpen: false,
                          loading: Boolean(msg.loading?.stage1),
                          hasData: stage1.length > 0,
                          metaExtra: stage1Meta,
                          summaryClassName: 'stage1',
                          children: (
                            <>
                              {msg.loading?.stage1 && (
                                <div className="stage-loading">
                                  <div className="spinner"></div>
                                  <span>Running Stage 1: Collecting individual responses...</span>
                                </div>
                              )}
                              {msg.stage1 && <Stage1 responses={msg.stage1} showTitle={false} />}
                            </>
                          ),
                        })}

                        {renderStagePanel({
                          messageIndex: index,
                          stage: 'stage2',
                          title: 'Stage 2: Peer Rankings',
                          defaultOpen: false,
                          loading: Boolean(msg.loading?.stage2),
                          hasData: stage2.length > 0,
                          metaExtra: stage2Meta,
                          summaryClassName: 'stage2',
                          children: (
                            <>
                              {msg.loading?.stage2 && (
                                <div className="stage-loading">
                                  <div className="spinner"></div>
                                  <span>Running Stage 2: Peer rankings...</span>
                                </div>
                              )}
                              {msg.stage2 && (
                                <Stage2
                                  rankings={msg.stage2}
                                  labelToModel={msg.metadata?.label_to_model}
                                  aggregateRankings={msg.metadata?.aggregate_rankings}
                                  showTitle={false}
                                />
                              )}
                            </>
                          ),
                        })}

                        {renderStagePanel({
                          messageIndex: index,
                          stage: 'stage3',
                          title: 'Stage 3: Final Council Answer',
                          defaultOpen: true,
                          loading: Boolean(msg.loading?.stage3),
                          hasData: Boolean(msg.stage3),
                          metaExtra: stage3Meta,
                          summaryClassName: 'stage3',
                          children: (
                            <>
                              {msg.loading?.stage3 && (
                                <div className="stage-loading">
                                  <div className="spinner"></div>
                                  <span>Running Stage 3: Final synthesis...</span>
                                </div>
                              )}
                              {msg.stage3 && <Stage3 finalResponse={msg.stage3} showTitle={false} />}
                            </>
                          ),
                        })}

                        {renderStagePanel({
                          messageIndex: index,
                          stage: 'usage',
                          title: 'Usage: Estimated Tokens',
                          defaultOpen: false,
                          loading: anyLoading,
                          hasData: anyData,
                          metaExtra: `total ${fmt(totalTokens)}`,
                          summaryClassName: 'usage',
                          children: (
                            <div className="usage-panel">
                              <div className="usage-total">
                                <div className="usage-total-label">Estimated total</div>
                                <div className="usage-total-value">{fmt(totalTokens)}</div>
                              </div>

                              <div className="usage-rows">
                                <div className="usage-row">
                                  <span className="usage-key">User prompt</span>
                                  <span className="usage-val">{fmt(userTokens)}</span>
                                </div>
                                <div className="usage-row">
                                  <span className="usage-key">Stage 1 outputs</span>
                                  <span className="usage-val">{fmt(stage1Tokens)}</span>
                                </div>
                                <div className="usage-row">
                                  <span className="usage-key">Stage 2 outputs</span>
                                  <span className="usage-val">{fmt(stage2Tokens)}</span>
                                </div>
                                <div className="usage-row">
                                  <span className="usage-key">Stage 3 output</span>
                                  <span className="usage-val">{fmt(stage3Tokens)}</span>
                                </div>
                              </div>

                              {stage1ByModel.length > 0 && (
                                <div className="usage-breakdown">
                                  <div className="usage-breakdown-title">Stage 1 breakdown</div>
                                  <ul className="usage-breakdown-list">
                                    {stage1ByModel.map((x) => (
                                      <li key={x.model}>
                                        <span className="usage-breakdown-model">{x.model}</span>
                                        <span className="usage-breakdown-tokens">{fmt(x.tokens)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {stage2ByModel.length > 0 && (
                                <div className="usage-breakdown">
                                  <div className="usage-breakdown-title">Stage 2 breakdown</div>
                                  <ul className="usage-breakdown-list">
                                    {stage2ByModel.map((x) => (
                                      <li key={x.model}>
                                        <span className="usage-breakdown-model">{x.model}</span>
                                        <span className="usage-breakdown-tokens">{fmt(x.tokens)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="usage-note">
                                Heuristic estimate — actual tokenization varies by model/tokenizer.
                              </div>
                            </div>
                          ),
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            ))}
          </>
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <textarea
          className="message-input"
          placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={3}
        />
        <button
          type="submit"
          className="send-button"
          disabled={!input.trim() || isLoading}
        >
          Send
        </button>
      </form>
    </div>
  );
}
