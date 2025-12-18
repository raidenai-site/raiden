"use client";

import { useState } from "react";
import type { Chat } from "@/lib/api";

interface SidebarProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  loading: boolean;
}

export default function Sidebar({ chats, selectedChatId, onSelectChat, loading }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredChats = chats.filter(chat =>
    chat.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const trackedCount = chats.filter(c => c.settings?.enabled || c.is_tracked).length;

  return (
    <div className="w-80 bg-space-surface/80 backdrop-blur-xl border-r border-space-border/50 flex flex-col h-full">
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
                  className={`w-full p-3 rounded-xl mb-1 text-left transition-all duration-200 group ${
                    isSelected
                      ? "bg-space-accent/10 border border-space-accent/30"
                      : isTracked
                        ? "bg-gradient-to-r from-space-accent/10 to-space-secondary/10 border border-space-accent/20 hover:from-space-accent/15 hover:to-space-secondary/15"
                        : "hover:bg-space-card/50 border border-transparent"
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
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold ${
                          isTracked 
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
                        <span className={`font-medium text-sm truncate ${isSelected ? "text-space-accent" : "text-space-text"}`}>
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
                      {/* AI Status - only shown when tracked */}
                      {isTracked && (
                        isAutoPilot ? (
                          <span className="flex items-center gap-1 text-[10px] text-space-success mt-0.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-space-success animate-pulse" />
                            AI Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-space-text-muted mt-0.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-space-text-muted" />
                            AI Inactive
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
