"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [isValidSession, setIsValidSession] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const router = useRouter();

    // Check if user has a valid recovery session
    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            // Check if this is a password recovery session
            if (session) {
                setIsValidSession(true);
            } else {
                // Try to get session from URL hash (Supabase appends tokens there)
                const hashParams = new URLSearchParams(window.location.hash.substring(1));
                const accessToken = hashParams.get('access_token');
                const refreshToken = hashParams.get('refresh_token');
                const type = hashParams.get('type');

                if (accessToken && type === 'recovery') {
                    // Set the session with the recovery tokens
                    const { error } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken || '',
                    });

                    if (!error) {
                        setIsValidSession(true);
                    }
                }
            }
            setCheckingSession(false);
        };

        checkSession();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords don't match");
            return;
        }

        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }

        setLoading(true);

        const { error } = await supabase.auth.updateUser({
            password: password,
        });

        if (error) {
            setError(error.message);
        } else {
            setSuccess(true);
            // Redirect to login after 2 seconds
            setTimeout(() => {
                router.push('/');
            }, 2000);
        }

        setLoading(false);
    };

    if (checkingSession) {
        return (
            <div className="min-h-screen flex items-center justify-center relative">
                <div className="stars-bg" />
                <div className="relative z-10 text-center">
                    <div className="w-16 h-16 mx-auto mb-6 relative">
                        <div className="absolute inset-0 rounded-full border-2 border-space-accent/20" />
                        <div
                            className="absolute inset-0 rounded-full border-2 border-transparent border-t-space-accent animate-spin"
                            style={{ animationDuration: "1s" }}
                        />
                    </div>
                    <p className="text-space-text-dim text-sm">Verifying...</p>
                </div>
            </div>
        );
    }

    if (!isValidSession) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 relative">
                <div className="stars-bg" />
                <div className="relative z-10 w-full max-w-md text-center">
                    <div className="rounded-2xl p-8">
                        <div className="w-16 h-16 rounded-full bg-space-danger/20 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-space-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-space-text mb-2">Invalid or Expired Link</h2>
                        <p className="text-space-text-dim text-sm mb-6">
                            This password reset link is invalid or has expired. Please request a new one.
                        </p>
                        <button
                            onClick={() => router.push('/')}
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all"
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 relative">
                <div className="stars-bg" />
                <div className="relative z-10 w-full max-w-md text-center">
                    <div className="rounded-2xl p-8">
                        <div className="w-16 h-16 rounded-full bg-space-success/20 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-space-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-space-text mb-2">Password Updated!</h2>
                        <p className="text-space-text-dim text-sm">
                            Redirecting you to login...
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative">
            <div className="stars-bg" />

            <div className="relative z-10 w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-6">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center mx-auto mb-4">
                        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-display font-bold text-space-text">Raiden</h1>
                </div>

                {/* Reset Card */}
                <div className="rounded-2xl p-8">
                    <h2 className="text-xl font-semibold text-space-text mb-2 text-center">
                        Set New Password
                    </h2>
                    <p className="text-space-text-dim text-sm text-center mb-6">
                        Enter your new password below
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-space-text-dim mb-2">
                                New Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-space-bg/50 border border-space-border/50 rounded-xl text-space-text placeholder-space-text-muted focus:outline-none focus:ring-2 focus:ring-space-accent/50 focus:border-transparent transition-all"
                                placeholder="••••••••"
                                required
                                minLength={6}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-space-text-dim mb-2">
                                Confirm Password
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-space-bg/50 border border-space-border/50 rounded-xl text-space-text placeholder-space-text-muted focus:outline-none focus:ring-2 focus:ring-space-accent/50 focus:border-transparent transition-all"
                                placeholder="••••••••"
                                required
                                minLength={6}
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-space-danger/10 border border-space-danger/20 rounded-xl">
                                <p className="text-sm text-space-danger">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Updating...
                                </span>
                            ) : (
                                'Update Password'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button
                            onClick={() => router.push('/')}
                            className="text-sm text-space-text-dim hover:text-space-accent transition-colors"
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
