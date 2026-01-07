"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";
import type { Chat, AuthStatus, Profile, ChatMessage } from "./api";
import { chatCache } from "./cache";

// Auth hook - reduced polling, only checks once on mount then stops when connected
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false); // True after initial auth check completes
  const [error, setError] = useState<string | null>(null);
  const hasCheckedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const data = await api.getAuthStatus();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStatus(null);
      return null;
    }
  }, []);

  const login = useCallback(async () => {
    try {
      setLoading(true);
      await api.login();
      // Poll for status change after login initiated
      const pollInterval = setInterval(async () => {
        const data = await checkStatus();
        if (data?.is_active) {
          clearInterval(pollInterval);
          setLoading(false);
        }
      }, 2000);
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setLoading(false);
      }, 300000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }, [checkStatus]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
      setStatus({ has_session: false, is_active: false, cookies_ready: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    }
  }, []);

  // Initial check - poll until cookies_ready is true
  useEffect(() => {
    if (!hasCheckedRef.current) {
      hasCheckedRef.current = true;

      const pollUntilReady = async () => {
        setLoading(true);
        let attempts = 0;
        const maxAttempts = 30; // 30 * 500ms = 15 seconds max wait

        while (attempts < maxAttempts) {
          try {
            const data = await api.getAuthStatus();
            setStatus(data);
            setError(null);

            // If we got a response, we're initialized
            setLoading(false);
            setChecked(true);
            return;
          } catch (err) {
            setError(err instanceof Error ? err.message : "Connection failed");
          }

          attempts++;
          await new Promise(r => setTimeout(r, 500)); // Wait 500ms between checks
        }

        // Timeout - consider it checked even if backend didn't signal ready
        setLoading(false);
        setChecked(true);
      };

      pollUntilReady();
    }
  }, []);

  return { status, loading, checked, error, login, logout, checkStatus };
}

// Chats hook with WebSocket
export function useChats(onSuggestion?: (data: { chat_id: string; username: string; text: string }) => void) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // True after first WebSocket sidebar_update
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onSuggestionRef = useRef(onSuggestion);

  // Keep ref updated
  useEffect(() => {
    onSuggestionRef.current = onSuggestion;
  }, [onSuggestion]);

  const fetchChats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getChats();
      setChats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch chats");
    } finally {
      setLoading(false);
    }
  }, []);

  // Update a specific chat's settings locally for immediate UI feedback
  const updateChatSettingsLocal = useCallback((chatId: string, updates: Partial<api.ChatSettings>) => {
    setChats(prevChats => prevChats.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          settings: {
            enabled: chat.settings?.enabled ?? false,
            auto_reply: chat.settings?.auto_reply ?? false,
            custom_rules: chat.settings?.custom_rules ?? null,
            ...updates,
          },
          // Also update is_tracked if enabled is being set
          is_tracked: updates.enabled !== undefined ? updates.enabled : (chat.settings?.enabled ?? chat.is_tracked ?? false),
        };
      }
      return chat;
    }));
  }, []);

  useEffect(() => {
    fetchChats().then(() => {
      // If we got chats via HTTP, mark as ready (fallback if WS is slow)
      // Give WS 3 seconds to take over, otherwise use HTTP result
      setTimeout(() => {
        setReady(prev => prev ? prev : true);
      }, 3000);
    });

    // Ultimate fallback: if still not ready after 10 seconds, force it
    const fallbackTimer = setTimeout(() => {
      setReady(prev => {
        if (!prev) console.log("[useChats] Fallback: marking ready after timeout");
        return true;
      });
    }, 10000);

    // Setup WebSocket for real-time updates
    const connectWs = () => {
      try {
        wsRef.current = api.createSidebarWebSocket((data: unknown) => {
          const wsData = data as { event: string; chats?: Chat[]; chat_id?: string; username?: string; text?: string };
          if (wsData.event === "sidebar_update" && wsData.chats) {
            // First sidebar_update means backend is ready
            if (!ready) setReady(true);
            // Use incoming chats from server - they should have fresh settings
            setChats(wsData.chats);
          } else if (wsData.event === "global_state_changed") {
            // Refetch chats when global state changes (from another tab/window)
            fetchChats();
          } else if (wsData.event === "suggestion" && wsData.chat_id && wsData.text) {
            // Trigger suggestion callback
            onSuggestionRef.current?.({
              chat_id: wsData.chat_id,
              username: wsData.username || wsData.chat_id,
              text: wsData.text
            });
          }
        });




        wsRef.current.onclose = () => {
          // Reconnect after 3 seconds
          setTimeout(connectWs, 3000);
        };

        wsRef.current.onerror = () => {
          wsRef.current?.close();
        };
      } catch {
        // WebSocket connection failed, will retry
        setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      clearTimeout(fallbackTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchChats]);

  return { chats, loading, ready, error, refetch: fetchChats, updateChatSettingsLocal, setChats };
}

// Log state type for AI status messages
export interface LogState {
  type: "generating" | "sending" | "suggestion" | null;
  text: string | null;
}

// Single chat hook with WebSocket and caching
export function useChat(chatId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logState, setLogState] = useState<LogState>({ type: null, text: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const requestVersionRef = useRef<number>(0); // Track request versions to prevent stale updates

  const fetchHistory = useCallback(async (targetChatId: string, requestVersion: number) => {
    // Check cache first
    const cachedMessages = chatCache.getMessages(targetChatId);
    if (cachedMessages && cachedMessages.length > 0) {
      // Fetch fresh data in background to check for delta
      try {
        const data = await api.getChatHistory(targetChatId);
        // Only update if still on same chat AND same request version
        if (currentChatIdRef.current === targetChatId && requestVersionRef.current === requestVersion) {
          setMessages(data.messages);
          chatCache.setMessages(targetChatId, data.messages);
        }
      } catch {
        // Silent fail for background refresh, we have cache
      }
      return;
    }

    // No cache - fetch from API with loading state
    try {
      setLoading(true);
      const data = await api.getChatHistory(targetChatId);
      // Only update if still on same chat AND same request version
      if (currentChatIdRef.current === targetChatId && requestVersionRef.current === requestVersion) {
        setMessages(data.messages);
        chatCache.setMessages(targetChatId, data.messages);
        setError(null);
      }
    } catch (err) {
      // Only update if still on same chat AND same request version
      if (currentChatIdRef.current === targetChatId && requestVersionRef.current === requestVersion) {
        setMessages([]);
        setError(err instanceof Error ? err.message : "Failed to fetch history");
      }
    } finally {
      if (currentChatIdRef.current === targetChatId && requestVersionRef.current === requestVersion) {
        setLoading(false);
      }
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!chatId) return;
    try {
      // Clear log state when manually sending
      setLogState({ type: null, text: null });
      // Don't optimistically add - WebSocket will handle the update
      await api.sendMessage(chatId, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  }, [chatId]);

  const acceptSuggestion = useCallback(async (suggestionText: string) => {
    if (!chatId || !suggestionText) return;
    try {
      // Clear log state
      setLogState({ type: null, text: null });
      await api.sendMessage(chatId, suggestionText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send suggestion");
    }
  }, [chatId]);

  const dismissSuggestion = useCallback(() => {
    setLogState({ type: null, text: null });
  }, []);

  const regenerateSuggestion = useCallback(async () => {
    if (!chatId) return;
    try {
      // The backend will send log events via WebSocket
      await api.regenerateSuggestion(chatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
      setLogState({ type: null, text: null });
    }
  }, [chatId]);

  useEffect(() => {
    // Update ref to track current chat
    currentChatIdRef.current = chatId;

    if (!chatId) {
      setMessages([]);
      setLogState({ type: null, text: null });
      setError(null);
      return;
    }

    // Increment version to invalidate any pending requests
    requestVersionRef.current += 1;
    const currentVersion = requestVersionRef.current;

    // Clear previous chat's data immediately when switching chats
    // Then check cache or show loading
    const cachedMessages = chatCache.getMessages(chatId);
    if (cachedMessages && cachedMessages.length > 0) {
      setMessages(cachedMessages);
      setLoading(false);
    } else {
      setMessages([]); // Clear old messages while loading new chat
      setLoading(true);
    }
    setLogState({ type: null, text: null });
    setError(null);

    fetchHistory(chatId, currentVersion);

    // Setup WebSocket for this chat
    const currentChatId = chatId; // Capture for closure
    try {
      wsRef.current = api.createChatWebSocket(chatId, (data: unknown) => {
        const wsData = data as { event: string; type?: string; text?: string; message?: ChatMessage };
        // Only process if still on same chat
        if (currentChatIdRef.current !== currentChatId) return;

        if (wsData.event === "new_message" && wsData.message) {
          // Deduplicate: only add if message_id doesn't already exist
          setMessages(prev => {
            const newMsg = wsData.message!;
            const exists = newMsg.message_id && prev.some(m => m.message_id === newMsg.message_id);
            if (exists) {
              console.log("[WS] Skipping duplicate message:", newMsg.message_id);
              return prev; // Don't add duplicate
            }
            const updated = [...prev, newMsg];
            chatCache.setMessages(currentChatId, updated);
            return updated;
          });
        } else if (wsData.event === "log") {
          // Handle log events
          if (wsData.type === "clear") {
            setLogState({ type: null, text: null });
          } else if (wsData.type === "generating" || wsData.type === "sending" || wsData.type === "suggestion") {
            setLogState({ type: wsData.type, text: wsData.text || null });
          }
        }
      });
    } catch {
      // WebSocket failed
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [chatId, fetchHistory]);

  const refetch = useCallback(() => {
    if (chatId) {
      fetchHistory(chatId, requestVersionRef.current);
    }
  }, [chatId, fetchHistory]);

  return {
    messages,
    logState,
    loading,
    error,
    sendMessage,
    acceptSuggestion,
    dismissSuggestion,
    regenerateSuggestion,
    refetch,
  };
}

// Chat settings hook with caching
export function useChatSettings(chatId: string | null) {
  const [settings, setSettings] = useState<api.ChatSettings>({
    enabled: false,
    auto_reply: false,
    custom_rules: null,
  });
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Fetch settings from API when chat changes
  const fetchSettings = useCallback(async () => {
    if (!chatId) return;

    // Check cache first
    const cachedSettings = chatCache.getSettings(chatId);
    if (cachedSettings) {
      setSettings(cachedSettings);

      // Refresh in background
      try {
        const data = await api.getChatSettings(chatId);
        const newSettings = {
          enabled: data.enabled ?? false,
          auto_reply: data.auto_reply ?? false,
          custom_rules: data.custom_rules ?? null,
        };
        setSettings(newSettings);
        chatCache.setSettings(chatId, newSettings);
      } catch {
        // Silent fail, we have cache
      }
      return;
    }

    // No cache - fetch from API
    try {
      setLoading(true);
      const data = await api.getChatSettings(chatId);
      const newSettings = {
        enabled: data.enabled ?? false,
        auto_reply: data.auto_reply ?? false,
        custom_rules: data.custom_rules ?? null,
      };
      setSettings(newSettings);
      chatCache.setSettings(chatId, newSettings);
    } catch {
      // If settings fetch fails, use defaults
      setSettings({
        enabled: false,
        auto_reply: false,
        custom_rules: null,
      });
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId) {
      // Check cache first for immediate display, otherwise reset to defaults
      const cachedSettings = chatCache.getSettings(chatId);
      if (cachedSettings) {
        setSettings(cachedSettings);
      } else {
        setSettings({
          enabled: false,
          auto_reply: false,
          custom_rules: null,
        });
      }
      fetchSettings();
    } else {
      setSettings({
        enabled: false,
        auto_reply: false,
        custom_rules: null,
      });
    }
  }, [chatId, fetchSettings]);

  const updateSettings = useCallback(async (updates: Partial<api.ChatSettings>, onError?: (msg: string) => void) => {
    if (!chatId) return;

    const previousSettings = { ...settings };
    const newSettings = { ...settings, ...updates };

    // Optimistic update
    setSettings(newSettings);
    chatCache.setSettings(chatId, newSettings);

    try {
      setUpdating(true);
      await api.updateChatSettings(chatId, updates);
    } catch (err) {
      // Revert on error
      setSettings(previousSettings);
      chatCache.setSettings(chatId, previousSettings);

      // Show error to user via callback
      const errorMessage = err instanceof Error ? err.message : "Failed to update settings";
      console.error("Failed to update settings:", errorMessage);

      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setUpdating(false);
    }
  }, [chatId, settings]);

  return { settings, loading, updating, updateSettings };
}

// Profile hook with caching - fetches profile only after chat is ready (history loaded)
export function useProfile(chatId: string | null, chatReady: boolean = false) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!chatId) return;

    // Check cache first
    const cachedProfile = chatCache.getProfile(chatId);
    if (cachedProfile) {
      setProfile(cachedProfile);

      // Refresh in background
      try {
        const data = await api.getProfile(chatId);
        setProfile(data);
        chatCache.setProfile(chatId, data);
      } catch {
        // Silent fail, we have cache
      }
      return;
    }

    // No cache - fetch from API
    try {
      setLoading(true);
      const data = await api.getProfile(chatId);
      setProfile(data);
      chatCache.setProfile(chatId, data);
      setError(null);
    } catch {
      setProfile(null);
      setError("Profile not generated yet");
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  const regenerateProfile = useCallback(async () => {
    if (!chatId) return;
    try {
      setLoading(true);
      const data = await api.generateProfile(chatId);
      setProfile(data);
      chatCache.setProfile(chatId, data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate profile");
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId && chatReady) {
      // Check cache first for immediate display, otherwise clear
      const cachedProfile = chatCache.getProfile(chatId);
      if (cachedProfile) {
        setProfile(cachedProfile);
      } else {
        setProfile(null);
      }
      // Only fetch profile after chat history has loaded
      fetchProfile();
    } else if (!chatId) {
      setProfile(null);
    }
  }, [chatId, chatReady, fetchProfile]);
  const updateProfile = useCallback((newProfile: Profile) => {
    if (!chatId) return;
    setProfile(newProfile);
    chatCache.setProfile(chatId, newProfile);
  }, [chatId]);

  return { profile, loading, error, regenerateProfile, updateProfile };
}
