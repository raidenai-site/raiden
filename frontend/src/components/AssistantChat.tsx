"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { AIConversation, AIMessage } from "@/lib/api";
import {
    getConversations,
    createConversation,
    getConversation,
    deleteConversation,
    renameConversation,
    sendAssistantMessage,
} from "@/lib/api";
import { useToast } from "@/components/ToastProvider";

export default function AssistantChat() {
    const { showToast } = useToast();
    const [conversations, setConversations] = useState<AIConversation[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<AIMessage[]>([]);
    const [conversationTitle, setConversationTitle] = useState("New Chat");
    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameInput, setRenameInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Load conversations on mount
    useEffect(() => {
        loadConversations();
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setOpenMenuId(null);
        if (openMenuId) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [openMenuId]);

    const loadConversations = async () => {
        try {
            const data = await getConversations();
            setConversations(data);

            // Auto-select the most recent conversation if one exists and none selected
            if (data.length > 0 && !selectedConversationId) {
                loadConversation(data[0].id);
            }
        } catch (err) {
            console.error("Failed to load conversations:", err);
        }
    };

    const loadConversation = async (id: string) => {
        setIsLoading(true);
        setIsSending(false); // Reset sending state when switching conversations
        try {
            const data = await getConversation(id);
            setMessages(data.messages);
            setConversationTitle(data.title);
            setSelectedConversationId(id);
        } catch (err) {
            console.error("Failed to load conversation:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleNewChat = async () => {
        setIsSending(false); // Reset sending state
        try {
            const newConv = await createConversation();
            setConversations((prev) => [newConv, ...prev]);
            setSelectedConversationId(newConv.id);
            setMessages([]);
            setConversationTitle("New Chat");
            setInputText("");
        } catch (err) {
            console.error("Failed to create conversation:", err);
        }
    };

    const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteConversation(id);
            setConversations((prev) => prev.filter((c) => c.id !== id));
            if (selectedConversationId === id) {
                setSelectedConversationId(null);
                setMessages([]);
                setConversationTitle("New Chat");
            }
        } catch (err) {
            console.error("Failed to delete conversation:", err);
        }
    };

    const handleSend = async () => {
        if (!inputText.trim() || isSending) return;

        // Create conversation if none selected
        let convId = selectedConversationId;
        if (!convId) {
            try {
                const newConv = await createConversation();
                setConversations((prev) => [newConv, ...prev]);
                convId = newConv.id;
                setSelectedConversationId(convId);
            } catch (err) {
                console.error("Failed to create conversation:", err);
                return;
            }
        }

        const userText = inputText;
        setInputText("");
        setIsSending(true);

        // Optimistically add user message
        const tempUserMsg: AIMessage = {
            id: Date.now(),
            role: "user",
            content: userText,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, tempUserMsg]);

        try {
            const response = await sendAssistantMessage(convId, userText);

            // Replace temp message with real ones
            setMessages((prev) => [
                ...prev.slice(0, -1), // Remove temp user message
                response.user_message,
                response.assistant_message,
            ]);

            // Update title if changed
            if (response.conversation_title !== conversationTitle) {
                setConversationTitle(response.conversation_title);
                setConversations((prev) =>
                    prev.map((c) =>
                        c.id === convId ? { ...c, title: response.conversation_title } : c
                    )
                );
            }
        } catch (err: unknown) {
            console.error("Failed to send message:", err);
            // Remove temp message on error
            setMessages((prev) => prev.slice(0, -1));
            setInputText(userText); // Restore input
            // Note: Rate limit errors are already shown by global apiFetch handler
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const filteredConversations = conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex h-full w-full">
            {/* Conversation Sidebar */}
            <div className="w-72 bg-[#0a0a0a]/95 border-r border-space-border/20 flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-space-border/50">
                    <button
                        onClick={handleNewChat}
                        className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-space-secondary hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-space-secondary/20 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-300"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Chat
                    </button>

                    {/* Search */}
                    <div className="relative mt-3">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-space-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search chats..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-space-card border border-space-border/50 rounded-lg text-sm text-space-text placeholder:text-space-text-muted focus:border-space-accent transition-colors"
                        />
                    </div>
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {filteredConversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-space-text-dim p-4">
                            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span className="text-sm text-center">No conversations yet</span>
                            <span className="text-xs text-space-text-muted mt-1">Start a new chat!</span>
                        </div>
                    ) : (
                        filteredConversations.map((conv) => (
                            <div key={conv.id} className="relative mb-1">
                                {renamingId === conv.id ? (
                                    // Rename input mode
                                    <div className="p-2">
                                        <input
                                            type="text"
                                            value={renameInput}
                                            onChange={(e) => setRenameInput(e.target.value)}
                                            onKeyDown={async (e) => {
                                                if (e.key === "Enter") {
                                                    const newTitle = renameInput.trim() || "New Chat";
                                                    // Optimistic update
                                                    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, title: newTitle } : c));
                                                    if (selectedConversationId === conv.id) setConversationTitle(newTitle);
                                                    setRenamingId(null);
                                                    // Persist to backend
                                                    try {
                                                        await renameConversation(conv.id, newTitle);
                                                    } catch (err) {
                                                        console.error("Failed to rename:", err);
                                                    }
                                                } else if (e.key === "Escape") {
                                                    setRenamingId(null);
                                                }
                                            }}
                                            onBlur={async () => {
                                                const newTitle = renameInput.trim() || "New Chat";
                                                // Optimistic update
                                                setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, title: newTitle } : c));
                                                if (selectedConversationId === conv.id) setConversationTitle(newTitle);
                                                setRenamingId(null);
                                                // Persist to backend
                                                try {
                                                    await renameConversation(conv.id, newTitle);
                                                } catch (err) {
                                                    console.error("Failed to rename:", err);
                                                }
                                            }}
                                            autoFocus
                                            className="w-full px-2 py-1.5 bg-space-card border border-space-accent rounded-lg text-sm text-space-text focus:outline-none"
                                        />
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <div
                                            onClick={() => loadConversation(conv.id)}
                                            className={`w-full p-3 rounded-xl text-left transition-all duration-300 ease-out group flex items-center justify-between cursor-pointer ${selectedConversationId === conv.id
                                                ? "bg-gradient-to-r from-space-accent/20 to-space-accent-light/10 border border-space-accent/30 shadow-lg shadow-space-accent/10 translate-x-1"
                                                : "hover:bg-white/5 border border-transparent hover:translate-x-1"
                                                }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <span className={`block text-sm font-medium truncate ${selectedConversationId === conv.id ? "text-white" : "text-space-text"}`}>
                                                    {conv.title}
                                                </span>
                                            </div>
                                            {/* Three dots menu trigger */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                                                }}
                                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-space-card transition-all"
                                            >
                                                <svg className="w-4 h-4 text-space-text-dim" fill="currentColor" viewBox="0 0 20 20">
                                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                                </svg>
                                            </button>
                                        </div>
                                        {/* Dropdown menu - outside the main clickable area */}
                                        {openMenuId === conv.id && (
                                            <div
                                                className="absolute right-2 top-12 w-32 bg-[#1a1a1a] border border-space-border rounded-lg shadow-2xl overflow-hidden"
                                                style={{ zIndex: 9999 }}
                                            >
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRenameInput(conv.title);
                                                        setRenamingId(conv.id);
                                                        setOpenMenuId(null);
                                                    }}
                                                    className="w-full px-3 py-2.5 text-left text-sm text-space-text hover:bg-white/10 flex items-center gap-2 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                    Rename
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        handleDeleteConversation(conv.id, e);
                                                        setOpenMenuId(null);
                                                    }}
                                                    className="w-full px-3 py-2.5 text-left text-sm text-space-danger hover:bg-space-danger/20 flex items-center gap-2 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-space-surface/20 relative">
                {/* Stars Background */}
                <div className="stars-bg" />

                {/* Header */}
                <div className="px-6 py-4 border-b border-space-border/50 bg-space-surface/60 backdrop-blur-md relative z-10">
                    <div className="text-center">
                        <h2 className="text-lg font-semibold text-space-text">{conversationTitle}</h2>
                    </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 relative z-10">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-space-text-dim">
                            <div className="w-16 h-16 rounded-full bg-space-card/50 flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 animate-spin text-space-accent" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            </div>
                            <span className="text-sm">Loading conversation...</span>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-space-text-dim">
                            <h3 className="text-xl font-semibold text-space-text mb-4">How can I help you?</h3>
                            <div className="flex flex-wrap gap-2 justify-center max-w-md">
                                {[
                                    "What did I talk about with @username?",
                                    "Summarize my recent conversations",
                                    "Find messages about a topic",
                                ].map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        onClick={() => setInputText(suggestion)}
                                        className="px-3 py-2 text-xs bg-space-card/50 border border-space-border/50 rounded-lg text-space-text-dim hover:text-space-text hover:border-space-accent/50 transition-colors"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((msg, i) => {
                            const isRecent = i >= messages.length - 2;
                            return (
                                <div
                                    key={msg.id}
                                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} ${isRecent ? "animate-message-entry" : ""}`}
                                    style={isRecent ? { animationDelay: `${(i - (messages.length - 2)) * 0.1}s` } : undefined}
                                >
                                    <div className={`max-w-[70%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                                        <div
                                            className={`rounded-[20px] px-4 py-2.5 ${msg.role === "user"
                                                ? "bg-space-accent text-white shadow-md"
                                                : "bg-[#262626] text-space-text"
                                                }`}
                                        >
                                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Typing indicator */}
                    {isSending && (
                        <div className="flex justify-start animate-slide-up">
                            <div className="bg-space-card rounded-2xl rounded-bl-md px-4 py-3">
                                <div className="typing-indicator">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="border-t border-space-border/30 bg-space-surface/60 backdrop-blur-md p-3 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="flex-1">
                            <textarea
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask me anything..."
                                rows={1}
                                disabled={isSending}
                                className="w-full px-4 py-3 bg-space-card border border-space-border/50 rounded-xl text-sm text-space-text placeholder:text-space-text-muted resize-none focus:border-space-accent transition-all disabled:opacity-50"
                                style={{ minHeight: "48px", maxHeight: "120px" }}
                            />
                        </div>
                        <button
                            onClick={handleSend}
                            disabled={!inputText.trim() || isSending}
                            className="p-3 btn-primary rounded-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                        >
                            {isSending ? (
                                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
}
