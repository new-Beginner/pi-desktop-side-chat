"use strict";

const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 80;

function now() {
  return new Date().toISOString();
}

function nid(prefix) {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeConversation() {
  const createdAt = now();
  return {
    id: nid("c"),
    title: "",
    createdAt,
    updatedAt: createdAt,
    messages: [],
  };
}

function titleFrom(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.length > 36 ? `${line.slice(0, 36)}…` : line;
}

function createStore() {
  let state = { version: 1, activeId: null, conversations: [] };

  function find(id) {
    return state.conversations.find((item) => item.id === id) || null;
  }

  function ensureActive() {
    if (state.activeId && find(state.activeId)) return find(state.activeId);
    if (state.conversations.length === 0) {
      const created = makeConversation();
      state.conversations.unshift(created);
      state.activeId = created.id;
      return created;
    }
    state.activeId = state.conversations[0].id;
    return state.conversations[0];
  }

  function trim() {
    for (const conversation of state.conversations) {
      if (conversation.messages.length > MAX_MESSAGES) {
        conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
      }
    }
    if (state.conversations.length > MAX_CONVERSATIONS) {
      const keep = new Set([state.activeId]);
      state.conversations = state.conversations
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .filter((item) => {
          if (keep.has(item.id) || keep.size < MAX_CONVERSATIONS) {
            keep.add(item.id);
            return true;
          }
          return false;
        });
    }
  }

  return {
    snapshot() {
      ensureActive();
      return clone(state);
    },

    load(raw) {
      if (!raw || typeof raw !== "object") return;
      const conversations = Array.isArray(raw.conversations)
        ? raw.conversations
            .filter((item) => item && typeof item.id === "string")
            .map((item) => ({
              id: String(item.id),
              title: String(item.title ?? ""),
              createdAt: String(item.createdAt ?? now()),
              updatedAt: String(item.updatedAt ?? now()),
              messages: Array.isArray(item.messages)
                ? item.messages
                    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
                    .map((message) => ({
                      id: String(message.id ?? nid("m")),
                      role: message.role,
                      content: String(message.content ?? ""),
                      createdAt: String(message.createdAt ?? now()),
                      error: message.error === true,
                      ...(Array.isArray(message.attachments) && message.attachments.length ? { attachments: message.attachments.filter(a => a && typeof a.id === "string").map(a => ({ id: a.id, name: String(a.name || "").slice(0, 255), size: Number(a.size) || 0, kind: a.kind === "image" ? "image" : "file", mimeType: String(a.mimeType || "") })) } : {}),
                    }))
                : [],
            }))
        : [];
      state = {
        version: 1,
        activeId: typeof raw.activeId === "string" ? raw.activeId : null,
        conversations,
      };
      ensureActive();
      trim();
    },

    newConversation() {
      const created = makeConversation();
      state.conversations.unshift(created);
      state.activeId = created.id;
      trim();
      return clone(created);
    },

    select(id) {
      if (!find(id)) return null;
      state.activeId = id;
      return clone(find(id));
    },

    deleteConversation(id) {
      state.conversations = state.conversations.filter((item) => item.id !== id);
      if (state.activeId === id) state.activeId = null;
      ensureActive();
      return this.snapshot();
    },

    addUserMessage(text, attachments = []) {
      const conversation = ensureActive();
      conversation.messages.push({
        id: nid("m"),
        role: "user",
        content: String(text),
        ...(attachments.length ? { attachments: clone(attachments) } : {}),
        createdAt: now(),
        error: false,
      });
      conversation.updatedAt = now();
      if (!conversation.title) conversation.title = titleFrom(text || attachments[0]?.name);
      trim();
      return clone(conversation);
    },

    addAssistantMessage(conversationId, text, extra = {}) {
      const conversation = find(conversationId);
      if (!conversation) return null;
      conversation.messages.push({
        id: nid("m"),
        role: "assistant",
        content: String(text ?? ""),
        createdAt: now(),
        error: extra.error === true,
      });
      conversation.updatedAt = now();
      trim();
      return clone(conversation);
    },

    active() {
      return clone(ensureActive());
    },
  };
}

module.exports = {
  createStore,
  titleFrom,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
};
