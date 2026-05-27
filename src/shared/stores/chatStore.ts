import { create } from 'zustand';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface PinnedTable {
  database: string;
  table: string;
  ddl: string;
}

export interface Conversation {
  id: string;
  title: string;
  database: string;
  messages: ChatMsg[];
  pinnedTables: PinnedTable[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  createConversation: (database: string) => string;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: ChatMsg) => void;
  updateLastAssistantMessage: (conversationId: string, content: string) => void;
  pinTable: (conversationId: string, table: PinnedTable) => void;
  unpinTable: (conversationId: string, database: string, table: string) => void;
}

const STORAGE_KEY = 'dbmind-chat-history';
const KEY_ACTIVE_ID = 'dbmind-active-conv-id';
const MAX_CONVERSATIONS = 50;

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(KEY_ACTIVE_ID);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(KEY_ACTIVE_ID, id);
    } else {
      localStorage.removeItem(KEY_ACTIVE_ID);
    }
  } catch { /* ignore */ }
}

function persist(conversations: Conversation[]) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted.slice(0, MAX_CONVERSATIONS)));
}

/** Get sorted conversations (most recent first) */
function sortedConvs(convs: Conversation[]): Conversation[] {
  return [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useChatStore = create<ChatState>((set) => {
  const conversations = loadConversations();
  const savedActiveId = loadActiveId();

  // Determine initial active conversation:
  // 1. Restore saved activeId if it still exists
  // 2. Fall back to the most recent conversation
  let initialActiveId: string | null = null;
  if (savedActiveId && conversations.some((c) => c.id === savedActiveId)) {
    initialActiveId = savedActiveId;
  } else if (conversations.length > 0) {
    initialActiveId = sortedConvs(conversations)[0].id;
  }

  return {
    conversations,
    activeConversationId: initialActiveId,

    createConversation: (database) => {
      const id = crypto.randomUUID();
      const conv: Conversation = {
        id,
        title: 'New Chat',
        database,
        messages: [],
        pinnedTables: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set((state) => {
        const conversations = [conv, ...state.conversations];
        persist(conversations);
        saveActiveId(id);
        return { conversations, activeConversationId: id };
      });
      return id;
    },

    deleteConversation: (id) =>
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id);
        persist(conversations);
        const activeConversationId =
          state.activeConversationId === id
            ? conversations.length > 0
              ? conversations[0].id
              : null
            : state.activeConversationId;
        saveActiveId(activeConversationId);
        return { conversations, activeConversationId };
      }),

    setActiveConversation: (id) => {
      saveActiveId(id);
      set({ activeConversationId: id });
    },

    addMessage: (conversationId, message) =>
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const messages = [...c.messages, message];
          const title = c.messages.length === 0 && message.role === 'user'
            ? message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '')
            : c.title;
          return { ...c, messages, title, updatedAt: Date.now() };
        });
        persist(conversations);
        return { conversations };
      }),

    updateLastAssistantMessage: (conversationId, content) =>
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const messages = [...c.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            messages[messages.length - 1] = { ...last, content };
          } else {
            messages.push({ id: crypto.randomUUID(), role: 'assistant', content });
          }
          return { ...c, messages, updatedAt: Date.now() };
        });
        persist(conversations);
        return { conversations };
      }),

    pinTable: (conversationId, table) =>
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          if (c.pinnedTables.some((p) => p.database === table.database && p.table === table.table)) return c;
          return { ...c, pinnedTables: [...c.pinnedTables, table], updatedAt: Date.now() };
        });
        persist(conversations);
        return { conversations };
      }),

    unpinTable: (conversationId, database, table) =>
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            pinnedTables: c.pinnedTables.filter((p) => !(p.database === database && p.table === table)),
            updatedAt: Date.now(),
          };
        });
        persist(conversations);
        return { conversations };
      }),
  };
});
