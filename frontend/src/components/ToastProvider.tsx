"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { setRateLimitHandler } from "@/lib/api";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
    id: number;
    type: ToastType;
    message: string;
}

interface ToastContextType {
    toasts: Toast[];
    showToast: (type: ToastType, message: string) => void;
    dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within ToastProvider");
    }
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [nextId, setNextId] = useState(1);

    const showToast = useCallback((type: ToastType, message: string) => {
        const id = nextId;
        setNextId((prev) => prev + 1);
        setToasts((prev) => [...prev, { id, type, message }]);

        // Auto dismiss after 5 seconds
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
    }, [nextId]);

    // Register global rate limit handler
    useEffect(() => {
        setRateLimitHandler((msg) => showToast("error", msg));
    }, [showToast]);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
    );
}

function ToastContainer({
    toasts,
    onDismiss
}: {
    toasts: Toast[];
    onDismiss: (id: number) => void;
}) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
}

function ToastItem({
    toast,
    onDismiss
}: {
    toast: Toast;
    onDismiss: (id: number) => void;
}) {
    const [isExiting, setIsExiting] = useState(false);

    const handleDismiss = () => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 300); // Wait for animation
    };

    const styles = {
        success: {
            bg: "bg-space-success/10",
            border: "border-space-success/30",
            icon: "text-space-success",
            text: "text-space-success",
        },
        error: {
            bg: "bg-space-danger/10",
            border: "border-space-danger/30",
            icon: "text-space-danger",
            text: "text-space-danger",
        },
        warning: {
            bg: "bg-space-warning/10",
            border: "border-space-warning/30",
            icon: "text-space-warning",
            text: "text-space-warning",
        },
        info: {
            bg: "bg-space-accent/10",
            border: "border-space-accent/30",
            icon: "text-space-accent",
            text: "text-space-accent",
        },
    };

    const s = styles[toast.type];

    const icons = {
        success: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
        ),
        error: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        ),
        warning: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        ),
        info: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    };

    return (
        <div
            className={`
                ${s.bg} ${s.border} border backdrop-blur-xl
                px-4 py-3 rounded-xl shadow-lg
                flex items-start gap-3 min-w-[300px] max-w-[400px]
                transition-all duration-300 ease-out
                ${isExiting ? 'opacity-0 translate-x-full' : 'animate-slide-up'}
            `}
        >
            <div className={s.icon}>{icons[toast.type]}</div>
            <p className={`text-sm ${s.text} flex-1`}>{toast.message}</p>
            <button
                onClick={handleDismiss}
                className="text-space-text-muted hover:text-space-text transition-colors"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}
