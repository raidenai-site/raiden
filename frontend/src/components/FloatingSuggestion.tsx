"use client";

import { useState } from "react";
import { sendMessage } from "@/lib/api";

export interface Suggestion {
    chat_id: string;
    username: string;
    text: string;
    id: string; // For unique key
}

interface FloatingSuggestionProps {
    suggestion: Suggestion | null;
    onAccept: (chatId: string) => void;
    onDismiss: () => void;
    onRegenerate: (chatId: string) => void;
}

export default function FloatingSuggestion({
    suggestion,
    onAccept,
    onDismiss,
    onRegenerate,
}: FloatingSuggestionProps) {
    const [sending, setSending] = useState(false);

    if (!suggestion) return null;

    const handleAccept = async () => {
        setSending(true);
        try {
            await sendMessage(suggestion.chat_id, suggestion.text);
            onAccept(suggestion.chat_id);
        } catch (err) {
            console.error("Failed to send suggestion:", err);
        } finally {
            setSending(false);
        }
    };

    const handleRegenerate = () => {
        onRegenerate(suggestion.chat_id);
    };

    return (
        <div className="fixed bottom-6 inset-x-0 z-50 flex justify-center px-4 animate-slide-up">
            <div className="w-full max-w-lg bg-space-surface/95 backdrop-blur-xl border border-space-border/50 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 bg-gradient-to-r from-space-accent/10 to-space-secondary/10 border-b border-space-border/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-space-secondary flex items-center justify-center text-white text-sm font-semibold">
                            {suggestion.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <span className="text-sm font-medium text-space-text">{suggestion.username}</span>
                            <div className="flex items-center gap-1 text-[10px] text-space-accent">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                                </svg>
                                AI Suggestion
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onDismiss}
                        className="p-1.5 rounded-lg hover:bg-space-card transition-colors"
                    >
                        <svg className="w-4 h-4 text-space-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Suggestion Text */}
                <div className="px-4 py-3">
                    <p className="text-sm text-space-text leading-relaxed">{suggestion.text}</p>
                </div>

                {/* Actions */}
                <div className="px-4 py-3 bg-space-bg/30 border-t border-space-border/30 flex items-center justify-end gap-2">
                    <button
                        onClick={handleRegenerate}
                        disabled={sending}
                        className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-text transition-colors flex items-center gap-1"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate
                    </button>
                    <button
                        onClick={onDismiss}
                        disabled={sending}
                        className="px-3 py-1.5 text-xs font-medium text-space-text-dim hover:text-space-text btn-secondary rounded-lg transition-colors"
                    >
                        Dismiss
                    </button>
                    <button
                        onClick={handleAccept}
                        disabled={sending}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-space-secondary text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {sending ? (
                            <>
                                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Sending...
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Send
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
