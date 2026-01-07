"use client";

import { useState } from "react";
import type { Chat, GlobalSettings } from "@/lib/api";

interface SidebarProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  loading: boolean;
  globalSettings: GlobalSettings;
  onEnableAll: (rules: string) => Promise<void>;
  onDisableAll: () => Promise<void>;
  onUpdateGlobalRules: (rules: string) => Promise<void>;
}

export default function Sidebar({
  chats,
  selectedChatId,
  onSelectChat,
  loading,
  globalSettings,
  onEnableAll,
  onDisableAll,
  onUpdateGlobalRules,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showGlobalModal, setShowGlobalModal] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const filteredChats = chats.filter(chat =>
    chat.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const trackedCount = chats.filter(c => c.settings?.enabled || c.is_tracked).length;

  const handleGlobalToggle = async () => {
    if (globalSettings.auto_reply_all) {
      // Turn OFF - disable all
      setIsToggling(true);
      try {
        await onDisableAll();
      } finally {
        setIsToggling(false);
      }
    } else {
      // Turn ON - check if global rules already exist
      if (globalSettings.global_rules) {
        // Rules exist - enable directly
        setIsToggling(true);
        try {
          await onEnableAll(globalSettings.global_rules);
        } finally {
          setIsToggling(false);
        }
      } else {
        // No rules - show modal to set them
        setShowGlobalModal(true);
      }
    }
  };

  const handleEnableWithRules = async (rules: string) => {
    setIsToggling(true);
    try {
      await onEnableAll(rules);
      setShowGlobalModal(false);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="w-80 bg-[#0a0a0a]/95 border-r border-space-border/20 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-space-border/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-space-text">Messages</h2>
          {trackedCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-space-accent/10 text-space-accent rounded-full">
              {trackedCount} active
            </span>
          )}
        </div>

        {/* Auto Reply ALL Toggle */}
        <div className="mb-3 p-3 bg-space-card/50 rounded-xl border border-space-border/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-space-secondary" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
              </svg>
              <span className="text-sm font-medium text-space-text">Auto Reply ALL</span>
              <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gradient-to-r from-purple-600 to-space-secondary text-white rounded uppercase">
                Pro
              </span>
            </div>
            <button
              onClick={handleGlobalToggle}
              disabled={isToggling}
              className={`toggle-track ${globalSettings.auto_reply_all ? "active" : ""} ${isToggling ? "opacity-50" : ""}`}
              style={globalSettings.auto_reply_all ? { background: "var(--space-secondary)" } : {}}
            />
          </div>
        </div>

        {/* Global Rules Button - Separate Card */}
        <button
          onClick={() => setShowGlobalModal(true)}
          className="mb-4 w-full p-3 flex items-center justify-center gap-2 text-sm font-medium text-space-text-dim hover:text-space-text bg-space-card/50 hover:bg-space-card border border-space-border/30 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {globalSettings.global_rules ? "Edit" : "Set"} Global Rules
        </button>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-space-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-space-card border border-space-border/50 rounded-xl text-sm text-space-text placeholder:text-space-text-muted focus:border-space-accent transition-colors"
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-space-text-dim">
            <div className="typing-indicator mb-3">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="text-sm">Loading conversations...</span>
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-space-text-dim p-4">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm">No conversations found</span>
          </div>
        ) : (
          <div className="p-2">
            {filteredChats.map((chat) => {
              const isTracked = chat.settings?.enabled || chat.is_tracked;
              const isAutoPilot = chat.settings?.auto_reply;
              const isSelected = selectedChatId === chat.id;

              return (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className={`w-full p-3 rounded-xl mb-1 text-left transition-all duration-300 ease-out group border ${isSelected
                    ? isTracked
                      ? "bg-gradient-to-r from-space-accent/20 to-space-secondary/20 border-space-secondary/50 shadow-lg shadow-space-secondary/10 translate-x-1" // Selected + AI: Blue/Pink Mix + Pink Border
                      : "bg-gradient-to-r from-space-accent/20 to-space-accent-light/10 border-space-accent/30 shadow-lg shadow-space-accent/10 translate-x-1" // Selected + No AI: Blue
                    : isTracked
                      ? "bg-gradient-to-r from-purple-900/20 to-space-secondary/10 border-space-secondary/30 hover:border-space-secondary/50 hover:from-purple-900/30 hover:to-space-secondary/20 hover:translate-x-1" // AI Only: Purple/Pink
                      : "bg-transparent border-transparent hover:bg-white/5 hover:translate-x-1" // Default
                    }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative">
                      {chat.profile_pic ? (
                        <img
                          src={chat.profile_pic}
                          alt={chat.username}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold ${isTracked
                          ? "bg-gradient-to-br from-space-accent to-space-secondary text-white"
                          : "bg-space-card text-space-text-dim"
                          }`}>
                          {chat.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`font-medium text-sm truncate ${isSelected
                          ? isTracked
                            ? "bg-gradient-to-r from-white via-purple-200 to-space-secondary bg-clip-text text-transparent font-bold"
                            : "bg-gradient-to-r from-white via-blue-100 to-space-accent-light bg-clip-text text-transparent font-bold"
                          : "text-space-text"
                          }`}>
                          {chat.username}
                        </span>
                        {isAutoPilot && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-space-secondary/10 text-space-secondary rounded">
                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                            </svg>
                            AUTO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-space-text-dim truncate">
                        {chat.last_message || "No messages yet"}
                      </p>
                      {/* AI Status */}
                      {isTracked ? (
                        <span className="flex items-center gap-1 text-[10px] text-space-success mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-space-success animate-pulse" />
                          AI Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-space-text-muted mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-space-text-muted" />
                          AI Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Global Rules Modal */}
      {showGlobalModal && (
        <GlobalRulesModal
          currentRules={globalSettings.global_rules || ""}
          isEnabled={globalSettings.auto_reply_all}
          isLoading={isToggling}
          onSave={handleEnableWithRules}
          onSaveRulesOnly={onUpdateGlobalRules}
          onClose={() => setShowGlobalModal(false)}
        />
      )}
    </div>
  );
}

function GlobalRulesModal({
  currentRules,
  isEnabled,
  isLoading,
  onSave,
  onSaveRulesOnly,
  onClose,
}: {
  currentRules: string;
  isEnabled: boolean;
  isLoading: boolean;
  onSave: (rules: string) => Promise<void>;
  onSaveRulesOnly: (rules: string) => Promise<void>;
  onClose: () => void;
}) {
  const [rules, setRules] = useState(currentRules);
  const [isSavingRules, setIsSavingRules] = useState(false);

  const handleSave = async () => {
    await onSave(rules);
  };

  const handleSaveRulesOnly = async () => {
    setIsSavingRules(true);
    try {
      await onSaveRulesOnly(rules);
      onClose();
    } finally {
      setIsSavingRules(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-space-surface border border-space-border/50 rounded-2xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-space-border/30 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-space-text">
              Global AI Rules
            </h3>
            <p className="text-xs text-space-text-dim mt-0.5">
              These rules will be applied as custom rules to all chats
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-space-card transition-colors"
          >
            <svg className="w-5 h-5 text-space-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-space-text mb-2">
                Global AI Instructions
              </label>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Add global instructions for the AI...&#10;&#10;Examples:&#10;• Be friendly and helpful&#10;• Keep responses concise&#10;• Always use proper grammar&#10;• Respond in a casual tone"
                rows={6}
                className="w-full px-4 py-3 bg-space-card border border-space-border/50 rounded-xl text-sm text-space-text placeholder:text-space-text-muted resize-none focus:border-space-accent focus:outline-none transition-all"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-space-border/30 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-space-text-dim hover:text-space-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveRulesOnly}
            disabled={isSavingRules}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 bg-gradient-to-r from-purple-600 to-space-secondary text-white hover:opacity-90 transition-opacity"
          >
            {isSavingRules ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Rules
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
