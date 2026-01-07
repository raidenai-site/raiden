"use client";

import { useSupabaseAuth } from "@/components/AuthProvider";
import { useAuth } from "@/lib/hooks";
import AuthForm from "@/components/AuthForm";
import LoginTerminal from "@/components/LoginTerminal";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  const { session, loading: supabaseLoading, signOut: supabaseSignOut } = useSupabaseAuth();
  const { status, loading: botLoading, checked: botChecked, error, login, logout } = useAuth();

  // 1. Wait for Supabase to initialize

  if (!session) {
    return <AuthForm />;
  }

  if (supabaseLoading) {
    return <LoadingScreen message="Initializing..." />;
  }

  // // 2. Not authenticated with Supabase -> Show Login immediately
  // if (!session) {
  //   return <AuthForm />;
  // }

  // 3. Authenticated -> Wait for Bot connection
  if (!botChecked) {
    return <LoadingScreen message="Connecting to Raiden..." />;
  }

  // Authenticated with Supabase but bot is still loading (e.g., during login process)
  if (botLoading && !status?.is_active) {
    return <LoadingScreen message="Connecting to Raiden..." />;
  }

  // Connection error - show offline state
  if (error && !status) {
    return <OfflineScreen error={error} onSignOut={supabaseSignOut} />;
  }

  // Authenticated with Supabase but bot not active - show Instagram login
  if (!status?.is_active) {
    return (
      <LoginTerminal
        onLogin={login}
        loading={botLoading}
        error={error}
        userEmail={session.user?.email || undefined}
        onSignOut={supabaseSignOut}
      />
    );
  }

  // Fully authenticated - show dashboard
  return <Dashboard onLogout={logout} userEmail={session.user?.email} onSignOut={supabaseSignOut} />;
}

function LoadingScreen({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      {/* Stars Background */}
      <div className="stars-bg" />

      <div className="relative z-10 text-center">
        <div className="w-16 h-16 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full border-2 border-space-accent/20" />
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-space-accent animate-spin"
            style={{ animationDuration: "1s" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-space-accent to-space-secondary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>
        <p className="text-space-text-dim text-sm">{message}</p>
      </div>
    </div>
  );
}

function OfflineScreen({ error, onSignOut }: { error: string; onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Stars Background */}
      <div className="stars-bg" />

      <div className="relative z-10 text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-space-danger/10 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-space-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-space-text mb-2">
          Connection Failed
        </h2>
        <p className="text-space-text-dim text-sm mb-4">
          Unable to connect to the Raiden backend
        </p>
        <div className="p-4 bg-space-danger/10 border border-space-danger/20 rounded-xl mb-6">
          <code className="text-xs text-space-danger">{error}</code>
        </div>
        <p className="text-space-text-muted text-xs mb-6">
          Make sure the backend server is running at localhost:8000
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 btn-secondary rounded-xl text-sm font-medium"
          >
            Retry Connection
          </button>
          <button
            onClick={onSignOut}
            className="px-6 py-3 text-space-text-dim hover:text-space-danger text-sm font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

