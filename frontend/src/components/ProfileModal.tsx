"use client";

import { useState } from "react";
import type { Profile } from "@/lib/api";
import { updateProfile } from "@/lib/api";

interface ProfileModalProps {
  profile: Profile | null;
  username: string;
  chatId: string;
  onClose: () => void;
  onProfileUpdate?: (newProfile: Profile) => void;
}

export default function ProfileModal({ profile, username, chatId, onClose, onProfileUpdate }: ProfileModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedJson, setEditedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setEditedJson(JSON.stringify(profile, null, 2));
    setIsEditing(true);
    setError(null);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setError(null);
  };

  const saveProfile = async () => {
    try {
      setError(null);
      setSaving(true);

      // Parse JSON to validate
      const parsed = JSON.parse(editedJson);

      // Save to backend
      await updateProfile(chatId, parsed);

      // Update parent
      if (onProfileUpdate) {
        onProfileUpdate(parsed);
      }

      setIsEditing(false);
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError("Invalid JSON format");
      } else {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    } finally {
      setSaving(false);
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
      <div className="relative w-full max-w-lg bg-space-surface border border-space-border/50 rounded-2xl overflow-hidden animate-slide-up shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-space-border/50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-space-text">
              AI Persona
            </h3>
            <p className="text-xs text-space-text-dim">
              Mimicry profile for {username}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-space-text-dim hover:text-space-text hover:bg-space-card rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {!profile ? (
            <div className="text-center py-12 text-space-text-dim">
              <div className="w-16 h-16 rounded-full bg-space-card/50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="font-medium mb-1">No profile generated</p>
              <p className="text-xs text-space-text-muted">Click &quot;Refresh Profile&quot; to analyze this conversation</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Dynamic Profile Fields */}
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(profile).map(([key, value]) => {
                  // Skip arrays and long text fields - they get their own sections
                  if (Array.isArray(value) || (typeof value === "string" && value.length > 50)) {
                    return null;
                  }
                  // Format key: snake_case to Title Case
                  const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                  return (
                    <ProfileField key={key} label={label} value={String(value)} />
                  );
                })}
              </div>

              {/* Array fields (like slang) */}
              {Object.entries(profile).map(([key, value]) => {
                if (!Array.isArray(value) || value.length === 0) return null;
                const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <div key={key} className="p-4 bg-space-card rounded-xl">
                    <span className="text-xs font-medium text-space-text-dim block mb-3">{label}</span>
                    <div className="flex flex-wrap gap-2">
                      {value.map((item, i) => (
                        <span key={i} className="px-2.5 py-1 bg-space-surface border border-space-border/50 rounded-lg text-xs text-space-text">
                          {String(item)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Long text fields */}
              {Object.entries(profile).map(([key, value]) => {
                if (Array.isArray(value) || typeof value !== "string" || value.length <= 50) return null;
                const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <div key={key} className="p-4 bg-space-card rounded-xl">
                    <span className="text-xs font-medium text-space-text-dim block mb-2">{label}</span>
                    <p className="text-sm text-space-text">{value}</p>
                  </div>
                );
              })}

              {/* JSON View / Edit */}
              <details className="group" open={isEditing}>
                <summary className="text-xs font-medium text-space-text-dim cursor-pointer hover:text-space-accent transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {isEditing ? "Edit Raw JSON" : "View Raw JSON"}
                </summary>
                <div className="mt-3 relative">
                  {!isEditing ? (
                    <>
                      <div className="absolute top-2 right-2 flex gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(profile, null, 2))}
                          className="px-2 py-1 text-[10px] font-medium bg-space-surface border border-space-border/50 rounded text-space-text-dim hover:text-space-accent hover:border-space-accent transition-colors"
                        >
                          Copy
                        </button>
                        <button
                          onClick={startEditing}
                          className="px-2 py-1 text-[10px] font-medium bg-space-accent/20 border border-space-accent/50 rounded text-space-accent hover:bg-space-accent/30 transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                      <pre className="p-4 bg-space-bg border border-space-border/50 rounded-xl text-xs text-space-text overflow-x-auto">
                        <code>{JSON.stringify(profile, null, 2)}</code>
                      </pre>
                    </>
                  ) : (
                    <>
                      {error && (
                        <div className="mb-2 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-xs text-red-400">
                          {error}
                        </div>
                      )}
                      <textarea
                        value={editedJson}
                        onChange={(e) => setEditedJson(e.target.value)}
                        className="w-full h-64 p-4 bg-space-bg border border-space-border/50 rounded-xl text-xs text-space-text font-mono resize-none focus:outline-none focus:border-space-accent"
                        spellCheck={false}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={cancelEditing}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium bg-space-surface border border-space-border/50 rounded-lg text-space-text-dim hover:text-space-text transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveProfile}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium bg-space-accent border border-space-accent rounded-lg text-white hover:bg-space-accent/80 transition-colors disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-space-card rounded-xl">
      <span className="text-[10px] font-medium text-space-text-dim uppercase tracking-wide block mb-1">{label}</span>
      <p className="text-sm text-space-text">{value}</p>
    </div>
  );
}

