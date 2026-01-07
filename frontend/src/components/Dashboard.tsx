"use client";

import { useState, useCallback, useEffect } from "react";
import { useChats, useChat, useChatSettings, useProfile } from "@/lib/hooks";
import { useToast } from "./ToastProvider";
import Sidebar from "./Sidebar";
import ChatView from "./ChatView";
import AssistantChat from "./AssistantChat";
import FloatingSuggestion, { Suggestion } from "./FloatingSuggestion";
import type { ChatSettings, GlobalSettings, MembershipInfo } from "@/lib/api";
import { getGlobalSettings, enableAllChats, disableAllChats, updateGlobalRules, getChats, regenerateSuggestion as apiRegenerateSuggestion, getMembership, createCheckoutSession, createPortalSession } from "@/lib/api";

interface DashboardProps {
  onLogout: () => Promise<void>;
  userEmail?: string;
  onSignOut?: () => void;
}

type TabType = "chats" | "assistant";

export default function Dashboard({ onLogout, userEmail, onSignOut }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>("chats");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [currentSuggestion, setCurrentSuggestion] = useState<Suggestion | null>(null);
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const { showToast } = useToast();

  // Handle incoming suggestions from WebSocket
  const handleSuggestion = useCallback((data: { chat_id: string; username: string; text: string }) => {
    setCurrentSuggestion({
      ...data,
      id: Date.now().toString() // Unique ID for the suggestion
    });
  }, []);

  const { chats, loading: chatsLoading, ready: backendReady, updateChatSettingsLocal, setChats } = useChats(handleSuggestion);

  const {
    messages,
    logState,
    loading: chatLoading,
    sendMessage,
    acceptSuggestion,
    dismissSuggestion,
    regenerateSuggestion,
  } = useChat(selectedChatId);

  const selectedChat = chats.find(c => c.id === selectedChatId) || null;
  const { settings, updateSettings: rawUpdateSettings } = useChatSettings(selectedChatId);
  // Profile fetches only after chat history has loaded (chatLoading becomes false)
  const chatReady = selectedChatId !== null && !chatLoading;
  const { profile, loading: profileLoading, regenerateProfile, updateProfile } = useProfile(selectedChatId, chatReady);

  // Global settings state
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    auto_reply_all: false,
    global_rules: null,
  });

  // Fetch global settings on mount
  useEffect(() => {
    getGlobalSettings()
      .then(setGlobalSettings)
      .catch(err => console.error("Failed to fetch global settings:", err));
  }, []);

  // Fetch membership on mount
  useEffect(() => {
    getMembership()
      .then(setMembership)
      .catch(err => console.error("Failed to fetch membership:", err));
  }, []);

  // Handle enable all chats
  const handleEnableAll = useCallback(async (rules: string) => {
    try {
      await enableAllChats(rules);
      setGlobalSettings({ auto_reply_all: true, global_rules: rules });
      // Refetch chats to update sidebar
      const updatedChats = await getChats();
      setChats(updatedChats);
      showToast("success", "AI enabled for all chats!");
    } catch (err) {
      console.error("Failed to enable all:", err);
      // Show the actual error message (e.g. "Upgrade to unlock!")
      const errorMsg = err instanceof Error ? err.message : "Failed to enable auto-reply for all chats";
      showToast("error", errorMsg);
    }
  }, [setChats, showToast]);

  // Handle disable all chats
  const handleDisableAll = useCallback(async () => {
    try {
      await disableAllChats();
      setGlobalSettings(prev => ({ ...prev, auto_reply_all: false }));
      // Refetch chats to update sidebar
      const updatedChats = await getChats();
      setChats(updatedChats);
      showToast("success", "AI disabled for all chats");
    } catch (err) {
      console.error("Failed to disable all:", err);
      showToast("error", "Failed to disable auto-reply");
    }
  }, [setChats, showToast]);

  // Handle update global rules (without changing auto_reply_all state)
  const handleUpdateGlobalRules = useCallback(async (rules: string) => {
    try {
      await updateGlobalRules(rules);
      setGlobalSettings(prev => ({ ...prev, global_rules: rules }));
      showToast("success", "Global rules saved!");
    } catch (err) {
      console.error("Failed to update global rules:", err);
      showToast("error", "Failed to save global rules");
    }
  }, [showToast]);

  // Handle upgrade to Pro
  const handleUpgrade = useCallback(async () => {
    try {
      const { url } = await createCheckoutSession();
      window.open(url, '_blank'); // Open checkout in new tab
    } catch (err) {
      console.error("Failed to create checkout:", err);
      showToast("error", "Failed to open checkout. Please try again.");
    }
  }, [showToast]);

  // Handle manage subscription
  const handleManage = useCallback(async () => {
    try {
      const { url } = await createPortalSession();
      window.open(url, '_blank');
    } catch (err) {
      console.error("Failed to create portal session:", err);
      showToast("error", "Failed to open billing portal. Please contact support.");
    }
  }, [showToast]);

  // Handle auto-upgrade from URL (e.g. redirect from landing page)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'true') {
      // Clear the param so it doesn't trigger again on refresh
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);

      // Trigger upgrade flow
      handleUpgrade();
    }
  }, [handleUpgrade]);

  // Wrap updateSettings to pass toast error handler and update sidebar immediately
  const updateSettings = useCallback(async (updates: Partial<ChatSettings>) => {
    // Update sidebar immediately (optimistic)
    if (selectedChatId) {
      updateChatSettingsLocal(selectedChatId, updates);
    }
    await rawUpdateSettings(updates, (errorMsg) => {
      // On error, the rawUpdateSettings hook reverts the settings
      // We also need to revert the sidebar - refetch chats would work but 
      // for now the settings cache handles the revert
      showToast("error", errorMsg);
    });
  }, [rawUpdateSettings, showToast, selectedChatId, updateChatSettingsLocal]);

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* Stars Background */}
      <div className="stars-bg" />

      {/* Loading overlay - shows until backend broadcasts initial sidebar */}
      {!backendReady && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 relative">
              <div className="absolute inset-0 rounded-full border-2 border-space-accent/20" />
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent border-t-space-accent animate-spin"
                style={{ animationDuration: "1s" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-space-text-dim text-sm">Initializing Raiden...</p>
            <p className="text-space-text-muted text-xs mt-2">Loading your conversations</p>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="h-14 border-b border-space-border/50 bg-[#0a0a0a]/95 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0 relative z-20">
        <div className="flex items-center gap-6">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            title="Refresh"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-lg font-display font-semibold text-space-text">Raiden</span>
          </button>

          {/* Browser-style Tabs */}
          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("chats")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all ${activeTab === "chats"
                ? "text-space-accent border-space-accent bg-space-card/50"
                : "text-space-text-dim border-transparent hover:text-space-text hover:bg-space-card/30"
                }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Chats
              </span>
            </button>
            <button
              onClick={() => setActiveTab("assistant")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all ${activeTab === "assistant"
                ? "text-space-accent border-space-accent bg-space-card/50"
                : "text-space-text-dim border-transparent hover:text-space-text hover:bg-space-card/30"
                }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Assistant
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-space-success/10 rounded-full">
            <div className="w-2 h-2 rounded-full bg-space-success animate-pulse" />
            <span className="text-xs font-medium text-space-success">Connected</span>
          </div>

          {/* Disconnect Instagram */}
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-warning btn-secondary rounded-lg transition-colors"
          >
            Disconnect
          </button>

          {/* User Dropdown - Far Right */}
          {userEmail && onSignOut && (
            <div className="relative group">
              <button className="flex items-center gap-2 px-3 py-1.5 bg-space-bg/50 rounded-full border border-space-border/30 hover:border-space-accent/50 transition-colors">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center text-white text-[10px] font-medium">
                  {userEmail.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-space-text-dim max-w-[120px] truncate">{userEmail}</span>
                <svg className="w-3 h-3 text-space-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              <div className="absolute right-0 top-full mt-2 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="bg-space-surface border border-space-border/50 rounded-xl shadow-xl overflow-hidden">
                  {/* Membership Info */}
                  <div className="px-4 py-3 border-b border-space-border/30">
                    <div className="text-xs text-space-text-muted mb-1">Current Plan</div>
                    <div className="flex items-center justify-between">
                      <a
                        href="#pricing"
                        className={`text-sm font-medium transition-all hover:scale-105 ${membership?.tier === 'paid'
                          ? 'bg-gradient-to-r from-white via-blue-300 to-blue-500 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]'
                          : 'text-space-text hover:text-space-accent'
                          }`}
                      >
                        {membership?.tier === 'paid' ? '✨ Pro' : 'Free Tier'}
                      </a>
                      {membership?.tier !== 'paid' && (
                        <button
                          onClick={handleUpgrade}
                          className="px-2 py-1 text-[10px] font-medium bg-gradient-to-r from-purple-600 to-space-secondary text-white rounded-lg hover:opacity-90 hover:scale-105 transition-all"
                        >
                          Upgrade
                        </button>
                      )}
                      {membership?.tier === 'paid' && (
                        <button
                          onClick={handleManage}
                          className="px-2 py-1 text-[10px] font-medium text-space-text-dim hover:text-space-accent transition-colors"
                        >
                          Manage
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sign Out */}
                  <button
                    onClick={onSignOut}
                    className="w-full px-4 py-2.5 text-sm text-left text-space-danger hover:bg-space-danger/10 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {activeTab === "chats" ? (
          <>
            {/* Sidebar */}
            <Sidebar
              chats={chats}
              selectedChatId={selectedChatId}
              onSelectChat={setSelectedChatId}
              loading={chatsLoading}
              globalSettings={globalSettings}
              onEnableAll={handleEnableAll}
              onDisableAll={handleDisableAll}
              onUpdateGlobalRules={handleUpdateGlobalRules}
            />

            {/* Main Area */}
            <main className="flex-1 flex flex-col overflow-hidden">
              {selectedChat ? (
                <ChatView
                  chat={selectedChat}
                  messages={messages}
                  logState={logState}
                  settings={settings}
                  profile={profile}
                  profileLoading={profileLoading}
                  chatLoading={chatLoading}
                  onSendMessage={sendMessage}
                  onAcceptSuggestion={acceptSuggestion}
                  onDismissSuggestion={dismissSuggestion}
                  onRegenerateSuggestion={regenerateSuggestion}
                  onUpdateSettings={updateSettings}
                  onRegenerateProfile={regenerateProfile}
                  onProfileUpdate={updateProfile}
                />
              ) : (
                <EmptyState loading={chatLoading} />
              )}
            </main>
          </>
        ) : (
          <AssistantChat />
        )}
      </div>

      {/* Floating Suggestion Popup */}
      <FloatingSuggestion
        suggestion={currentSuggestion}
        onAccept={(chatId) => {
          setCurrentSuggestion(null);
          showToast("success", "Message sent!");
        }}
        onDismiss={() => setCurrentSuggestion(null)}
        onRegenerate={async (chatId) => {
          setCurrentSuggestion(null);
          try {
            await apiRegenerateSuggestion(chatId);
            // Will receive new suggestion via WebSocket
          } catch (err) {
            showToast("error", "Failed to regenerate");
          }
        }}
      />
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center relative">
      <div className="relative text-center p-8">
        {loading ? (
          <div className="flex flex-col items-center">
            <div className="typing-indicator mb-4">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="text-space-text-dim text-sm">Loading...</span>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-space-text mb-2">
              Select a conversation
            </h2>
            <p className="text-space-text-dim text-sm max-w-sm">
              Choose a conversation from the sidebar to start chatting or enable AI automation
            </p>

            <div className="mt-8 flex items-center justify-center gap-6 text-space-text-muted text-xs">
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-space-success" />
                AI Active
              </span>
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-space-secondary" />
                Auto-Reply
              </span>
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-space-text-muted" />
                Inactive
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
