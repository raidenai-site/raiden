"use client";

import { useState } from "react";
import { useChats, useChat, useChatSettings, useProfile } from "@/lib/hooks";
import Sidebar from "./Sidebar";
import ChatView from "./ChatView";

interface DashboardProps {
  onLogout: () => Promise<void>;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const { chats, loading: chatsLoading } = useChats();
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
  const { settings, updateSettings } = useChatSettings(selectedChatId);
  // Profile fetches only after chat history has loaded (chatLoading becomes false)
  const chatReady = selectedChatId !== null && !chatLoading;
  const { profile, loading: profileLoading, regenerateProfile } = useProfile(selectedChatId, chatReady);

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* Stars Background */}
      <div className="stars-bg" />
      
      {/* Top Bar */}
      <header className="h-14 border-b border-space-border/50 bg-space-surface/80 backdrop-blur-xl flex items-center justify-between px-6 flex-shrink-0 relative z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-lg font-display font-semibold text-space-text">Raiden</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-space-success/10 rounded-full">
            <div className="w-2 h-2 rounded-full bg-space-success animate-pulse" />
            <span className="text-xs font-medium text-space-success">Connected</span>
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-danger btn-secondary rounded-lg transition-colors"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Sidebar */}
        <Sidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
          loading={chatsLoading}
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
            />
          ) : (
            <EmptyState loading={chatLoading} />
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center relative">
      {/* Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-64 h-64 bg-space-accent/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/3 right-1/3 w-64 h-64 bg-space-secondary/5 rounded-full blur-[100px]" />
      </div>

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
            <div className="w-20 h-20 rounded-2xl bg-space-card/50 flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-space-text-dim opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>

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
