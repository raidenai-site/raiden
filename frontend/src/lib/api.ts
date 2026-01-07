const API_BASE = "http://localhost:8000";

// Token management - set by AuthProvider
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Global rate limit error handler
type RateLimitCallback = (message: string) => void;
let rateLimitCallback: RateLimitCallback | null = null;

export function setRateLimitHandler(callback: RateLimitCallback) {
  rateLimitCallback = callback;
}

// Wrapper for fetch that handles 429 globally
async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 429) {
    // Extract rate limit message
    try {
      const errorData = await res.clone().json();
      const resetTime = errorData?.detail?.reset_at;
      let msg = "You have reached your rate limit";
      if (resetTime) {
        // Calculate remaining time
        const resetDate = new Date(resetTime);
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();

        if (diffMs > 0) {
          const diffMins = Math.ceil(diffMs / 60000);
          if (diffMins >= 60) {
            const hours = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            msg += `, try again in ${hours}h ${mins}m`;
          } else {
            msg += `, try again in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
          }
        } else {
          msg += ", please try again";
        }
      } else if (errorData?.detail?.message) {
        msg = errorData.detail.message;
      }
      if (rateLimitCallback) {
        rateLimitCallback(msg);
      }
      throw new Error(msg);
    } catch (e) {
      if (e instanceof Error && e.message.includes("rate limit")) throw e;
      const msg = "You have reached your rate limit, please try again later";
      if (rateLimitCallback) rateLimitCallback(msg);
      throw new Error(msg);
    }
  }

  return res;
}

// Helper to build headers with optional auth
function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return headers;
}

function getJsonAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface ChatSettings {
  enabled: boolean;
  auto_reply: boolean;
  custom_rules: string | null;
}

export interface Chat {
  id: string;
  username: string;
  full_name: string | null;
  last_message: string | null;
  profile_pic: string | null;
  settings: ChatSettings | null;
  is_tracked?: boolean;
}

export interface AuthStatus {
  has_session: boolean;
  is_active: boolean;
  cookies_ready: boolean; // True after backend cookie check completes
}

export interface MembershipInfo {
  tier: string;
  auto_reply_limit: number;
  auto_reply_count: number;
  can_enable_more: boolean;
}

// Media object for photos, videos, reels, posts
export interface MediaObject {
  type: "photo" | "video" | "reel" | "post";
  url: string;
  alt?: string;
  ratio?: number;
}

// Single chat message with optional media
export interface ChatMessage {
  sender: string;
  text: string;
  is_me: boolean;
  media: MediaObject | null;
  message_id?: string; // Unique ID for deduplication
}

// Dynamic profile - keys come from backend
export type Profile = Record<string, string | string[]>;

// Global auto-reply settings
export interface GlobalSettings {
  auto_reply_all: boolean;
  global_rules: string | null;
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const res = await apiFetch(`${API_BASE}/global/settings`);
  if (!res.ok) throw new Error("Failed to fetch global settings");
  return res.json();
}

export async function enableAllChats(globalRules: string): Promise<{ status: string; updated_count: number }> {
  const res = await apiFetch(`${API_BASE}/global/enable-all`, {
    method: "POST",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ global_rules: globalRules }),
  });
  if (!res.ok) {
    // Check for pro_required error
    try {
      const errorData = await res.json();
      if (errorData.detail?.error === "pro_required") {
        throw new Error(errorData.detail.message);
      }
    } catch (e) {
      if (e instanceof Error) throw e;
    }
    throw new Error("Failed to enable all chats");
  }
  return res.json();
}

export async function disableAllChats(): Promise<{ status: string; updated_count: number }> {
  const res = await apiFetch(`${API_BASE}/global/disable-all`, {
    method: "POST",
    headers: getJsonAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to disable all chats");
  return res.json();
}

export async function updateGlobalRules(globalRules: string): Promise<{ status: string; global_rules: string }> {
  const res = await apiFetch(`${API_BASE}/global/rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ global_rules: globalRules }),
  });
  if (!res.ok) throw new Error("Failed to update global rules");
  return res.json();
}


// Auth endpoints - getAuthStatus optionally accepts token for background AI
export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await apiFetch(`${API_BASE}/auth/status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch auth status");
  return res.json();
}

// Login requires Supabase auth token
export async function login(): Promise<{ status: string }> {
  const headers = getAuthHeaders();
  console.log("🔐 Login headers:", headers);
  console.log("🔑 Current accessToken:", accessToken ? `${accessToken.substring(0, 30)}...` : "null");
  const res = await apiFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json();
}

export async function logout(): Promise<{ status: string }> {
  const res = await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  if (!res.ok) throw new Error("Logout failed");
  return res.json();
}

export async function getMembership(): Promise<MembershipInfo> {
  const res = await apiFetch(`${API_BASE}/auth/membership`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch membership");
  return res.json();
}

// Payment endpoints
export async function createCheckoutSession(): Promise<{ url: string }> {
  const res = await apiFetch(`${API_BASE}/payments/create-checkout`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create checkout session");
  return res.json();
}

export async function createPortalSession(): Promise<{ url: string }> {
  const res = await apiFetch(`${API_BASE}/payments/create-portal`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create portal session");
  return res.json();
}

// Chat endpoints - protected
export async function getChats(): Promise<Chat[]> {
  const res = await apiFetch(`${API_BASE}/instagram/chats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch chats");
  return res.json();
}

export async function getChatHistory(chatId: string): Promise<{ username: string; messages: ChatMessage[] }> {
  const res = await apiFetch(`${API_BASE}/chats/${encodeURIComponent(chatId)}/history`);
  if (!res.ok) throw new Error("Failed to fetch chat history");
  return res.json();
}

export async function getChatSettings(chatId: string): Promise<ChatSettings> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateChatSettings(
  chatId: string,
  settings: Partial<ChatSettings>
): Promise<{ status: string }> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/settings`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    // Try to parse error details
    try {
      const errorData = await res.json();
      if (errorData.detail?.error === "limit_reached") {
        throw new Error(errorData.detail.message);
      }
      throw new Error(typeof errorData.detail === 'string' ? errorData.detail : "Failed to update settings");
    } catch (e) {
      // If it's already an Error we threw, re-throw it
      if (e instanceof Error) throw e;
      throw new Error("Failed to update settings");
    }
  }
  return res.json();
}

export async function sendMessage(chatId: string, text: string): Promise<{ status: string; text: string }> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function startConversation(chatId: string): Promise<{ status: string; text: string }> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/start`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to start conversation");
  return res.json();
}

export async function regenerateSuggestion(chatId: string): Promise<{ status: string; text: string }> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/regenerate`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to regenerate suggestion");
  return res.json();
}

// Profile endpoints
export async function getProfile(chatId: string): Promise<Profile> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/profile`);
  if (!res.ok) throw new Error("Profile not found");
  return res.json();
}

export async function generateProfile(chatId: string): Promise<Profile> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/profile/generate`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to generate profile");
  return res.json();
}

export async function updateProfile(chatId: string, profileData: Profile): Promise<{ status: string }> {
  const res = await apiFetch(`${API_BASE}/instagram/chat/${encodeURIComponent(chatId)}/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_data: profileData }),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json();
}

// WebSocket helpers
export function createSidebarWebSocket(onMessage: (data: unknown) => void): WebSocket {
  const ws = new WebSocket(`ws://localhost:8000/ws/sidebar/global`);
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onMessage(data);
  };
  return ws;
}

export function createChatWebSocket(chatId: string, onMessage: (data: unknown) => void): WebSocket {
  const ws = new WebSocket(`ws://localhost:8000/ws/chat/${encodeURIComponent(chatId)}`);
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onMessage(data);
  };
  return ws;
}

// ============================================================
// AI ASSISTANT - CONVERSATION MEMORY
// ============================================================

export interface AIConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AIConversationWithMessages extends AIConversation {
  messages: AIMessage[];
}

export interface SendMessageResponse {
  user_message: AIMessage;
  assistant_message: AIMessage;
  conversation_title: string;
}

export async function getConversations(): Promise<AIConversation[]> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function createConversation(): Promise<AIConversation> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations`, {
    method: "POST",
    headers: getJsonAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function getConversation(id: string): Promise<AIConversationWithMessages> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function renameConversation(id: string, title: string): Promise<AIConversation> {
  const res = await apiFetch(`${API_BASE}/assistant/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename conversation");
  return res.json();
}

export async function sendAssistantMessage(
  conversationId: string,
  content: string
): Promise<SendMessageResponse> {
  // 429 errors are handled globally by apiFetch
  const res = await apiFetch(
    `${API_BASE}/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: getJsonAuthHeaders(),
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}
