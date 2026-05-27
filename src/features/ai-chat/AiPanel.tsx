import { useRef, useState, useEffect, useCallback } from 'react';
import { Bot, ChevronDown, Cpu } from 'lucide-react';
import { useTauriEvents } from '../../shared/hooks/useTauriEvents';
import { useChatStore } from '../../shared/stores/chatStore';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useSettingsStore } from '../../shared/stores/settingsStore';
import { AiConversationHeader } from './AiConversationHeader';
import { AiMessageBubble } from './AiMessageBubble';
import { AiInputBar } from './AiInputBar';

export function AiPanel() {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const updateLastAssistantMessage = useChatStore((s) => s.updateLastAssistantMessage);

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConnection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === activeConnectionId),
  );
  const activeTab = useEditorStore((s) =>
    s.tabs.find((t) => t.id === useEditorStore.getState().activeTabId),
  );

  const aiConnections = useSettingsStore((s) => s.ai.connections);
  const aiActiveId = useSettingsStore((s) => s.ai.activeId);
  const setActiveAiId = useSettingsStore((s) => s.setActiveId);
  const activeAi = aiConnections.find((c) => c.id === aiActiveId) ?? aiConnections[0];

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamBuffer = useRef<string>('');
  const streamingConvId = useRef<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const database = activeConv?.database ?? activeTab?.database ?? activeConnection?.database ?? '';

  // Detect if the last message is from user (AI hasn't responded yet)
  const messages = activeConv?.messages ?? [];
  const lastMsg = messages[messages.length - 1];
  const showThinking = isStreaming && (!lastMsg || lastMsg.role === 'user');

  useTauriEvents({
    onAiToken: useCallback(({ token }: { token: string }) => {
      const convId = streamingConvId.current;
      if (!convId) return;
      streamBuffer.current += token;
      updateLastAssistantMessage(convId, streamBuffer.current);
    }, [updateLastAssistantMessage]),
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages, showThinking]);

  const handleNew = useCallback(() => {
    createConversation(database);
  }, [createConversation, database]);

  const handleStreamStart = useCallback(() => {
    streamBuffer.current = '';
    setIsStreaming(true);
    streamingConvId.current = useChatStore.getState().activeConversationId;
  }, []);

  const handleStreamEnd = useCallback(() => {
    streamBuffer.current = '';
    setIsStreaming(false);
    streamingConvId.current = null;
  }, []);

  const hasActiveConv = activeConv && activeConv.messages.length > 0;

  return (
    <div className="ai-panel-content">
      <div className="ai-panel-header">
        <Bot size={16} />
        <span>AI Assistant</span>
        <div className="ai-model-switcher">
          <Cpu size={12} />
          <select
            className="ai-model-select"
            value={aiActiveId}
            onChange={(e) => setActiveAiId(e.target.value)}
          >
            {aiConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.model}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </div>
      </div>

      <AiConversationHeader
        conversations={conversations}
        activeId={activeConversationId ?? null}
        onSelect={setActiveConversation}
        onNew={handleNew}
        onDelete={deleteConversation}
        pinnedTables={activeConv?.pinnedTables ?? []}
        onUnpin={(db, tbl) => {
          if (activeConversationId) {
            useChatStore.getState().unpinTable(activeConversationId, db, tbl);
          }
        }}
      />

      <div className="ai-messages" ref={scrollRef}>
        {!hasActiveConv ? (
          <div className="ai-welcome">
            <Bot size={32} className="ai-welcome-icon" />
            <p>Ask about your data, write SQL, or debug queries.</p>
            <p className="ai-welcome-hint">
              Use <code>@db.table</code> to pin table DDL to context.
            </p>
            {!activeConversationId && (
              <button className="btn btn-primary ai-welcome-btn" onClick={handleNew}>
                Start new conversation
              </button>
            )}
          </div>
        ) : (
          activeConv.messages.map((msg) => (
            <AiMessageBubble key={msg.id} role={msg.role} content={msg.content} />
          ))
        )}
        {hasActiveConv && showThinking && (
          <div className="ai-thinking">
            <div className="ai-thinking-dots">
              <span />
              <span />
              <span />
            </div>
            <span>Thinking…</span>
          </div>
        )}
      </div>

      {activeConversationId && (
        <AiInputBar
          conversationId={activeConversationId}
          database={database}
          driver={activeConnection?.driver}
          onStreamStart={handleStreamStart}
          onStreamEnd={handleStreamEnd}
        />
      )}
    </div>
  );
}
