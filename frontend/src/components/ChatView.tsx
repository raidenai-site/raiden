"use client";

import { useState, useRef, useEffect } from "react";
import type { Chat, ChatSettings, Profile, ChatMessage, MediaObject } from "@/lib/api";
import type { LogState } from "@/lib/hooks";
import { startConversation } from "@/lib/api";
import ProfileModal from "./ProfileModal";

interface ChatViewProps {
  chat: Chat;
  messages: ChatMessage[];
  logState: LogState;
  settings: ChatSettings;
  profile: Profile | null;
  profileLoading: boolean;
  chatLoading: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onAcceptSuggestion: (text: string) => Promise<void>;
  onDismissSuggestion: () => void;
  onRegenerateSuggestion: () => Promise<void>;
  onUpdateSettings: (updates: Partial<ChatSettings>) => Promise<void>;
  onRegenerateProfile: () => Promise<void>;
  onProfileUpdate?: (newProfile: Profile) => void;
}

export default function ChatView({
  chat,
  messages,
  logState,
  settings,
  profile,
  profileLoading,
  chatLoading,
  onSendMessage,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRegenerateSuggestion,
  onUpdateSettings,
  onRegenerateProfile,
  onProfileUpdate,
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [viewingMedia, setViewingMedia] = useState<MediaObject | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  // When a suggestion comes in, prefill the input
  useEffect(() => {
    if (logState.type === "suggestion" && logState.text) {
      setInputText(logState.text);
    }
  }, [logState]);

  // Track if this is the initial load for this chat
  const isInitialLoadRef = useRef(true);
  const prevChatIdRef = useRef(chat.id);

  // Reset initial load flag when chat changes
  useEffect(() => {
    if (prevChatIdRef.current !== chat.id) {
      isInitialLoadRef.current = true;
      prevChatIdRef.current = chat.id;
    }
  }, [chat.id]);

  // Scroll to bottom - instant on initial load, smooth for new messages
  useEffect(() => {
    if (messages.length === 0) return;

    if (isInitialLoadRef.current) {
      // Instant scroll on initial load or chat switch
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      isInitialLoadRef.current = false;
    } else {
      // Smooth scroll for new messages
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    await onSendMessage(inputText);
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInitiateProtocol = async () => {
    setIsStarting(true);
    try {
      await startConversation(chat.id);
    } catch (err) {
      console.error("Failed to start conversation:", err);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-space-surface/20 relative">
      {/* Stars Background */}
      <div className="stars-bg" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-space-border/50 bg-space-surface/60 backdrop-blur-xl relative z-10">
        <div className="flex items-center justify-between">
          {/* User Info */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {chat.profile_pic ? (
                <img
                  src={chat.profile_pic}
                  alt={chat.username}
                  className={`w-11 h-11 rounded-full object-cover ${settings.enabled ? "ring-2 ring-space-accent ring-offset-2 ring-offset-space-surface" : ""
                    }`}
                />
              ) : (
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-semibold ${settings.enabled
                  ? "bg-gradient-to-br from-space-accent to-space-secondary text-white"
                  : "bg-space-card text-space-text-dim"
                  }`}>
                  {chat.username.charAt(0).toUpperCase()}
                </div>
              )}
              {settings.enabled && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-space-success border-2 border-space-surface" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-space-text">
                {chat.username}
              </h2>
              <div className="flex items-center gap-3 text-xs text-space-text-dim">
                {settings.enabled ? (
                  <span className="flex items-center gap-1 text-space-success">
                    <div className="w-1.5 h-1.5 rounded-full bg-space-success" />
                    AI Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-space-text-muted" />
                    AI Inactive
                  </span>
                )}
                {settings.auto_reply && (
                  <span className="flex items-center gap-1 text-space-secondary">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                    </svg>
                    Auto-Reply
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            {/* AI Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-xs text-space-text-dim font-medium">AI</span>
              <button
                onClick={() => {
                  // If turning AI off, also turn off auto-pilot
                  if (settings.enabled) {
                    onUpdateSettings({ enabled: false, auto_reply: false });
                  } else {
                    onUpdateSettings({ enabled: true });
                  }
                }}
                className={`toggle-track ${settings.enabled ? "active" : ""}`}
                aria-label="Toggle AI"
              />
            </label>

            {/* Auto-Pilot Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-xs text-space-text-dim font-medium">Auto-Pilot</span>
              <button
                onClick={() => {
                  // If turning auto-pilot on, also enable AI
                  if (!settings.auto_reply) {
                    onUpdateSettings({ auto_reply: true, enabled: true });
                  } else {
                    onUpdateSettings({ auto_reply: false });
                  }
                }}
                className={`toggle-track ${settings.auto_reply ? "active" : ""}`}
                style={settings.auto_reply ? { background: "var(--space-secondary)" } : {}}
                aria-label="Toggle auto-pilot"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="px-6 py-3 border-b border-space-border/30 bg-space-surface/30 backdrop-blur-sm flex items-center gap-2 relative z-10">
        <button
          onClick={handleInitiateProtocol}
          disabled={isStarting}
          className="px-3 py-2 btn-secondary rounded-lg text-xs font-medium flex items-center gap-2 disabled:opacity-50"
        >
          {isStarting ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          Start Conversation
        </button>

        <button
          onClick={onRegenerateProfile}
          disabled={profileLoading}
          className="px-3 py-2 btn-secondary rounded-lg text-xs font-medium flex items-center gap-2 disabled:opacity-50"
        >
          {profileLoading ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Refresh Profile
        </button>

        <button
          onClick={() => setShowProfileModal(true)}
          className="px-3 py-2 btn-secondary rounded-lg text-xs font-medium flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          View Persona
        </button>

        <button
          onClick={() => setShowSettingsModal(true)}
          className="px-3 py-2 btn-secondary rounded-lg text-xs font-medium flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Custom Rules
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3 relative z-10">
        {chatLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-space-text-dim">
            <div className="w-16 h-16 rounded-full bg-space-card/50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 animate-spin text-space-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1">Loading messages...</p>
            <p className="text-xs text-space-text-muted">Fetching conversation history</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-space-text-dim">
            <div className="w-16 h-16 rounded-full bg-space-card/50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1">No messages yet</p>
            <p className="text-xs text-space-text-muted">Start a conversation to get going</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.is_me;
            const sender = msg.sender;
            // Clean text - remove "[Replied to (username)]" or "[Replied]" suffixes
            const text = msg.text
              .replace(/\s*\[Replied to .+?\]\s*$/, "")
              .replace(/\s*\[Replied\]\s*$/, "")
              .trim();
            const media = msg.media;

            // Determine if we should show the username
            // Show username if it's not "Me" and not "Them" (i.e., it's a real username in a GC)
            const showUsername = !isMe && sender !== "Them" && sender.length > 0;

            // Only animate the last 3 messages to avoid re-animating old ones
            const isRecent = i >= messages.length - 3;

            return (
              <div
                key={`${i}-${msg.sender}-${msg.text.slice(0, 30)}`}
                className={`flex ${isMe ? "justify-end" : "justify-start"} ${isRecent ? "animate-message-entry" : ""}`}
                style={isRecent ? { animationDelay: `${Math.max(0, (i - (messages.length - 3))) * 0.05}s` } : undefined}
              >
                <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                  {showUsername && (
                    <span className="text-xs text-space-text-dim mb-1 px-1">
                      {sender}
                    </span>
                  )}
                  <div
                    className={`rounded-[20px] overflow-hidden ${isMe
                      ? "bg-space-accent text-white shadow-md"
                      : "bg-[#262626] text-space-text"
                      }`}
                  >
                    {/* Media Content */}
                    {media && (
                      <MediaRenderer media={media} isMe={isMe} onClick={() => setViewingMedia(media)} />
                    )}
                    {/* Text Content */}
                    {text && (
                      <div className="px-4 py-2.5">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area with Log Box */}
      <div className="border-t border-space-border/30 bg-space-surface/60 backdrop-blur-md p-3 relative z-20">
        {/* Log Box - positioned above input area */}
        {logState.type && (
          <div className="absolute bottom-full left-0 right-0 px-4 pb-2 pointer-events-auto">
            <div className="bg-space-card/95 border border-space-border/50 rounded-xl px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-up">
              {logState.type === "generating" && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 animate-spin text-space-accent" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-space-text-dim">{logState.text}</span>
                </div>
              )}

              {logState.type === "sending" && (
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-space-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-space-success">{logState.text}</span>
                </div>
              )}

              {logState.type === "suggestion" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-space-accent animate-pulse" />
                    <span className="text-xs font-medium text-space-accent uppercase tracking-wide">Auto-reply suggested</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (logState.text) {
                          onAcceptSuggestion(logState.text);
                          setInputText("");
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-purple-600 to-space-secondary text-white rounded-lg hover:opacity-90 transition-opacity"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => {
                        onDismissSuggestion();
                        setInputText("");
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-danger transition-colors rounded-lg hover:bg-space-danger/10"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={onRegenerateSuggestion}
                      className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-text transition-colors rounded-lg hover:bg-space-card flex items-center gap-1.5"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Regenerate
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className={`w-full px-4 py-3 bg-space-card border rounded-xl text-sm text-space-text placeholder:text-space-text-muted resize-none focus:border-space-accent transition-all ${logState.type === "suggestion" ? "border-space-accent/50" : "border-space-border/50"
                  }`}
                style={{ minHeight: "48px", maxHeight: "120px" }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-3 btn-primary rounded-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Profile Modal */}
      {showProfileModal && (
        <ProfileModal
          profile={profile}
          username={chat.username}
          chatId={chat.id}
          onClose={() => setShowProfileModal(false)}
          onProfileUpdate={onProfileUpdate}
        />
      )}

      {/* Media Viewer Modal */}
      {viewingMedia && (
        <MediaViewerModal
          media={viewingMedia}
          onClose={() => setViewingMedia(null)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          username={chat.username}
          onUpdateSettings={onUpdateSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}

// Media Renderer Component for photos, videos, reels, and posts
function MediaRenderer({ media, isMe, onClick }: { media: MediaObject; isMe: boolean; onClick?: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Determine dimensions based on media type
  const getMediaStyles = () => {
    switch (media.type) {
      case "reel":
        // Reels are tall (9:16 ratio)
        return { maxWidth: "200px", aspectRatio: "9/16" };
      case "post":
        // Posts are typically square or 4:5
        return { maxWidth: "280px", aspectRatio: media.ratio ? `${media.ratio}/1` : "1/1" };
      case "video":
        // Videos - use original ratio or default to 16:9
        return { maxWidth: "320px", aspectRatio: media.ratio ? `${media.ratio}/1` : "16/9" };
      case "photo":
      default:
        // Photos - flexible width
        return { maxWidth: "320px" };
    }
  };

  const mediaStyles = getMediaStyles();

  // Get media type label with icon
  const getMediaLabel = () => {
    switch (media.type) {
      case "reel":
        return (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
            Reel
          </span>
        );
      case "post":
        return (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.72L9 13l-3 4h12l-4-5z" />
            </svg>
            Post
          </span>
        );
      case "video":
        return (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
            Video
          </span>
        );
      case "photo":
      default:
        return (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
            </svg>
            Photo
          </span>
        );
    }
  };

  if (hasError) {
    return (
      <div className="p-4 flex items-center justify-center bg-space-card/50 min-h-[100px]">
        <div className="text-center">
          <div className={`text-xs font-medium mb-1 ${isMe ? "text-white/70" : "text-space-text-dim"}`}>
            {getMediaLabel()}
          </div>
          <span className={`text-xs ${isMe ? "text-white/50" : "text-space-text-muted"}`}>
            Failed to load
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative ${onClick ? "cursor-pointer group" : ""}`}
      style={mediaStyles}
      onClick={onClick}
    >
      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-space-card/30">
          <div className="w-6 h-6 border-2 border-space-accent/30 border-t-space-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Media Type Badge */}
      <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm z-10 ${isMe ? "bg-white/20 text-white" : "bg-black/40 text-white"
        }`}>
        {getMediaLabel()}
      </div>

      {/* Hover Overlay */}
      {onClick && !isLoading && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/0 group-hover:bg-white/20 flex items-center justify-center transition-all duration-200 opacity-0 group-hover:opacity-100">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </div>
        </div>
      )}

      {/* Image */}
      <img
        src={media.url}
        alt={media.alt || `${media.type} content`}
        className={`w-full h-full object-cover transition-opacity duration-200 ${isLoading ? "opacity-0" : "opacity-100"}`}
        style={mediaStyles}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      />

      {/* Video Play Icon Overlay */}
      {(media.type === "video" || media.type === "reel") && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform duration-200">
            <svg className="w-6 h-6 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// Media Viewer Modal - Full screen view for photos, videos, reels, posts
function MediaViewerModal({ media, onClose }: { media: MediaObject; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const getTypeLabel = () => {
    switch (media.type) {
      case "reel": return "Reel";
      case "post": return "Post";
      case "video": return "Video";
      case "photo": return "Photo";
      default: return "Media";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Content */}
      <div className="relative z-10 max-w-[90vw] max-h-[90vh] flex flex-col items-center animate-fade-in">
        {/* Header */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20">
          <div className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-medium">
            {getTypeLabel()}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Image */}
        <img
          src={media.url}
          alt={media.alt || `${media.type} content`}
          className={`max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
          onLoad={() => setIsLoading(false)}
        />

        {/* Video indicator */}
        {(media.type === "video" || media.type === "reel") && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-2 rounded-lg bg-black/50 backdrop-blur-sm text-white text-sm flex items-center gap-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Video preview - open in Instagram to play</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModal({
  settings,
  username,
  onUpdateSettings,
  onClose,
}: {
  settings: ChatSettings;
  username: string;
  onUpdateSettings: (updates: Partial<ChatSettings>) => Promise<void>;
  onClose: () => void;
}) {
  const [customRules, setCustomRules] = useState(settings.custom_rules || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ custom_rules: customRules || null });
      onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setIsSaving(false);
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
            <h3 className="text-lg font-semibold text-space-text">Custom Rules</h3>
            <p className="text-xs text-space-text-dim mt-0.5">Configure AI behavior for @{username}</p>
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
                AI Instructions
              </label>
              <textarea
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder="Add custom instructions for the AI when replying to this chat...&#10;&#10;Examples:&#10;• Always be friendly and casual&#10;• Use their name in responses&#10;• Never discuss work topics&#10;• Keep responses short"
                rows={6}
                className="w-full px-4 py-3 bg-space-card border border-space-border/50 rounded-xl text-sm text-space-text placeholder:text-space-text-muted resize-none focus:border-space-accent focus:outline-none transition-all"
              />
              <p className="text-xs text-space-text-muted mt-2">
                These rules will be used by the AI when generating replies for this conversation.
              </p>
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
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 btn-primary rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              "Save Rules"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
