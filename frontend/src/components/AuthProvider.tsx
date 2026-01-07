"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setAccessToken } from '@/lib/api';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
    getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            // Sync token with API module
            setAccessToken(session?.access_token ?? null);
            setLoading(false);
        }).catch((err) => {
            console.error("Auth initialization failed:", err);
            setLoading(false);
        });

        // Fallback timeout to prevent infinite loading
        const timeout = setTimeout(() => {
            setLoading((currentLoading) => {
                if (currentLoading) {
                    console.warn("Auth initialization timed out, forcing load completion");
                    return false;
                }
                return false;
            });
        }, 5000);

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
                // Sync token with API module
                setAccessToken(session?.access_token ?? null);
                setLoading(false);
            }
        );

        // Periodic token refresh every 30 minutes
        // This ensures the backend always has a fresh token for edge function calls
        const refreshInterval = setInterval(async () => {
            console.log("🔄 [AUTH] Periodic token refresh...");
            try {
                // Refresh the Supabase session (gets new token if needed)
                const { data } = await supabase.auth.refreshSession();
                if (data.session) {
                    setSession(data.session);
                    setUser(data.session.user);
                    setAccessToken(data.session.access_token);

                    // Push fresh token to backend via /auth/status
                    // This updates the bot's stored auth token for background AI calls
                    await fetch("http://localhost:8000/auth/status", {
                        headers: { "Authorization": `Bearer ${data.session.access_token}` }
                    });
                    console.log("✅ [AUTH] Token refreshed and synced to backend");
                }
            } catch (err) {
                console.error("⚠️ [AUTH] Token refresh failed:", err);
            }
        }, 30 * 60 * 1000); // 30 minutes

        // Cleanup function
        return () => {
            clearTimeout(timeout);
            subscription.unsubscribe();
            clearInterval(refreshInterval);
        };
    }, []);

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        return { error };
    };

    const signUp = async (email: string, password: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
        });
        return { error };
    };

    const signOut = async () => {
        try {
            await supabase.auth.signOut();
            // Clear token from API module
            setAccessToken(null);
            // Force page refresh to clear all state
            window.location.reload();
        } catch (error) {
            console.error("Sign out error:", error);
            // Force reload anyway
            window.location.reload();
        }
    };

    const resetPassword = async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        return { error };
    };

    const getAccessToken = () => {
        return session?.access_token ?? null;
    };

    return (
        <AuthContext.Provider value={{
            session,
            user,
            loading,
            signIn,
            signUp,
            signOut,
            resetPassword,
            getAccessToken,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useSupabaseAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useSupabaseAuth must be used within an AuthProvider');
    }
    return context;
}
