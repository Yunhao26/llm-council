import './Sidebar.css';
import WorkerStatusPanel from './WorkerStatusPanel';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  theme,
  onToggleTheme,
}) {
  const themeLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h1>LLM Council</h1>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={onToggleTheme}
            title={themeLabel}
            aria-label={themeLabel}
          >
            {themeLabel}
          </button>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="sidebar-body">
        <WorkerStatusPanel />

        <div className="conversation-list" aria-label="Conversation history">
          {conversations.length === 0 ? (
            <div className="no-conversations">No conversations yet</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${
                  conv.id === currentConversationId ? 'active' : ''
                }`}
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="conversation-title">
                  {conv.title || 'New Conversation'}
                </div>
                <div className="conversation-meta">
                  {conv.message_count} messages
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
