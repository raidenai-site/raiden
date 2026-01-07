// Simple in-memory cache for the session
// Stores: messages, settings, profile per chatId

import type { ChatMessage, Profile } from "./api";

export interface CachedChatData {
  messages: ChatMessage[];
  settings: {
    enabled: boolean;
    auto_reply: boolean;
    custom_rules: string | null;
  } | null;
  profile: Profile | null;
}

class ChatCache {
  private cache: Map<string, CachedChatData> = new Map();

  // Get cached data for a chat
  get(chatId: string): CachedChatData | null {
    return this.cache.get(chatId) || null;
  }

  // Check if chat has cached data
  has(chatId: string): boolean {
    return this.cache.has(chatId);
  }

  // Set messages for a chat
  setMessages(chatId: string, messages: ChatMessage[]): void {
    const existing = this.cache.get(chatId) || { messages: [], settings: null, profile: null };
    this.cache.set(chatId, { ...existing, messages });
  }

  // Get messages for a chat
  getMessages(chatId: string): ChatMessage[] | null {
    return this.cache.get(chatId)?.messages || null;
  }

  // Add new messages (delta) to existing cache
  addMessages(chatId: string, newMessages: ChatMessage[]): void {
    const existing = this.cache.get(chatId);
    if (existing) {
      existing.messages = [...existing.messages, ...newMessages];
    }
  }

  // Append single message
  appendMessage(chatId: string, message: ChatMessage): void {
    const existing = this.cache.get(chatId);
    if (existing) {
      existing.messages = [...existing.messages, message];
    }
  }

  // Set settings for a chat
  setSettings(chatId: string, settings: CachedChatData["settings"]): void {
    const existing = this.cache.get(chatId) || { messages: [], settings: null, profile: null };
    this.cache.set(chatId, { ...existing, settings });
  }

  // Get settings for a chat
  getSettings(chatId: string): CachedChatData["settings"] {
    return this.cache.get(chatId)?.settings || null;
  }

  // Set profile for a chat
  setProfile(chatId: string, profile: CachedChatData["profile"]): void {
    const existing = this.cache.get(chatId) || { messages: [], settings: null, profile: null };
    this.cache.set(chatId, { ...existing, profile });
  }

  // Get profile for a chat
  getProfile(chatId: string): CachedChatData["profile"] {
    return this.cache.get(chatId)?.profile || null;
  }

  // Clear cache for a specific chat
  clear(chatId: string): void {
    this.cache.delete(chatId);
  }

  // Clear all cache
  clearAll(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const chatCache = new ChatCache();

