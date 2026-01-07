"use client";

import { useState } from 'react';
import { useSupabaseAuth } from './AuthProvider';

export default function AuthForm() {
    const { signIn, signUp, resetPassword, loading: authLoading } = useSupabaseAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        if (isForgotPassword) {
            const { error } = await resetPassword(email);
            if (error) {
                setError(error.message);
            } else {
                setMessage('Check your email for a password reset link!');
            }
        } else if (isSignUp) {
            const { error } = await signUp(email, password);
            if (error) {
                setError(error.message);
            } else {
                setMessage('Check your email for a confirmation link!');
            }
        } else {
            const { error } = await signIn(email, password);
            if (error) {
                setError(error.message);
            }
        }

        setLoading(false);
    };

    // if (authLoading) block removed to prevent double loading screens. 
    // The parent component (page.tsx) handles the "Initializing..." state if needed.
    // If we are here, we want to show the form immediately even if background auth is still checking.

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative">
            {/* Stars Background */}
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

                {/* Auth Card */}
                <div className="rounded-2xl p-8">
                    <h2 className="text-xl font-semibold text-space-text mb-6 text-center">
                        {isForgotPassword ? 'Reset Password' : isSignUp ? 'Create Account' : 'Welcome Back'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-space-text-dim mb-2">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-space-bg/50 border border-space-border/50 rounded-xl text-space-text placeholder-space-text-muted focus:outline-none focus:ring-2 focus:ring-space-accent/50 focus:border-transparent transition-all"
                                placeholder="your@email.com"
                                required
                            />
                        </div>

                        {!isForgotPassword && (
                            <div>
                                <label className="block text-sm font-medium text-space-text-dim mb-2">
                                    Password
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
                        )}

                        {error && (
                            <div className="p-3 bg-space-danger/10 border border-space-danger/20 rounded-xl">
                                <p className="text-sm text-space-danger">{error}</p>
                            </div>
                        )}

                        {message && (
                            <div className="p-3 bg-space-success/10 border border-space-success/20 rounded-xl">
                                <p className="text-sm text-space-success">{message}</p>
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
                                    {isForgotPassword ? 'Sending...' : isSignUp ? 'Creating Account...' : 'Signing In...'}
                                </span>
                            ) : (
                                isForgotPassword ? 'Send Reset Link' : isSignUp ? 'Create Account' : 'Sign In'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 space-y-3 text-center">
                        {!isForgotPassword && !isSignUp && (
                            <button
                                onClick={() => {
                                    setIsForgotPassword(true);
                                    setError(null);
                                    setMessage(null);
                                }}
                                className="text-sm text-space-text-muted hover:text-space-accent transition-colors"
                            >
                                Forgot password?
                            </button>
                        )}

                        <div>
                            <button
                                onClick={() => {
                                    if (isForgotPassword) {
                                        setIsForgotPassword(false);
                                    } else {
                                        setIsSignUp(!isSignUp);
                                    }
                                    setError(null);
                                    setMessage(null);
                                }}
                                className="text-sm text-space-text-dim hover:text-space-accent transition-colors"
                            >
                                {isForgotPassword
                                    ? 'Back to sign in'
                                    : isSignUp
                                        ? 'Already have an account? Sign in'
                                        : "Don't have an account? Sign up"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-space-text-muted text-xs mt-6">
                    By continuing, you agree to our <a href="https://raidenai.site/terms" target="_blank" rel="noopener noreferrer" className="hover:text-space-text underline transition-colors">Terms of Service</a>
                </p>
            </div>
        </div>
    );
}
