/**
 * API client for the LLM Council backend.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Get health status for all configured workers (council + chairman).
   */
  async getWorkersHealth() {
    const response = await fetch(`${API_BASE}/api/workers/health`);
    if (!response.ok) {
      throw new Error('Failed to get workers health');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    if (!response.body) {
      throw new Error('Streaming response body is not available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines = [];

    const safeOnEvent = (eventType, event) => {
      try {
        onEvent(eventType, event);
      } catch (e) {
        console.error('SSE onEvent callback threw:', e);
      }
    };

    const flushEvent = () => {
      if (dataLines.length === 0) return;
      const dataText = dataLines.join('\n');
      dataLines = [];
      if (!dataText) return;

      if (dataText === '[DONE]') {
        safeOnEvent('done', { type: 'done' });
        return;
      }

      try {
        const event = JSON.parse(dataText);
        const eventType =
          event && typeof event === 'object' && typeof event.type === 'string'
            ? event.type
            : 'message';
        safeOnEvent(eventType, event);
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
        console.error('Bad SSE payload:', dataText.slice(0, 2000));
      }
    };

    const processLine = (rawLine) => {
      let line = rawLine;
      if (line.endsWith('\r')) line = line.slice(0, -1);

      // Blank line => end of an SSE event
      if (line === '') {
        flushEvent();
        return;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    };

    const processBuffer = () => {
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(rawLine);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      processBuffer();
    }

    // Flush any remaining decoder output + buffered data
    buffer += decoder.decode();
    processBuffer();
    if (buffer.length > 0) {
      processLine(buffer);
      buffer = '';
    }
    flushEvent();
  },
};
