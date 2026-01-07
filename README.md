<p align="center">
  <img src="logo.png" alt="Raiden Logo" width="100" />
</p>

<h1 align="center">Raiden</h1>

<p align="center">
  <strong>Your AI Twin for Instagram</strong>
</p>

<p align="center">
  <a href="https://github.com/raidenai-site/raiden/releases">
    <img src="https://img.shields.io/github/v/release/raidenai-site/raiden?style=for-the-badge&color=8B5CF6" alt="Release" />
  </a>
  <a href="https://raidenai.site">
    <img src="https://img.shields.io/badge/Website-raidenai.site-8B5CF6?style=for-the-badge" alt="Website" />
  </a>
  <a href="LICENSE.txt">
    <img src="https://img.shields.io/badge/License-Proprietary-blue?style=for-the-badge" alt="License" />
  </a>
</p>

<p align="center">
  Never miss a DM again. Raiden learns your style and replies like you — so you can focus on what matters while staying connected.
</p>

---

## ⚡ What is Raiden?

Raiden is a **desktop app** that uses AI to automate your Instagram DMs. It analyzes your past conversations to learn your unique voice, slang, and vibe — then replies **as you**.

✅ **100% Local & Private** — Your credentials and messages never leave your device  
✅ **Personality Cloning** — AI that actually sounds like you  
✅ **Auto-Pilot Mode** — Let Raiden handle conversations automatically  
✅ **Suggestion Mode** — Review AI drafts before sending  
✅ **AI Assistant** — Search your DMs with natural language  

---

## 🎯 Features

### 🧠 Clone Your Persona
Raiden analyzes your past conversations to learn your unique voice, slang, and vibe. It doesn't just reply—it replies *as you*.

### 🚀 Smart Auto-Pilot
Turn on Auto-Pilot for trusted friends and watch Raiden handle the chat. Or use Suggestion Mode to approve drafts before sending.

### 🔒 100% Private & Local
Raiden runs on your machine. Your credentials and messages never leave your device. Secure, private, and yours.

### ⚡ Ice Breakers & Openers
Never struggle with what to say. Raiden generates context-aware openers to start or revive any conversation instantly.

### ✏️ Custom Rules Per Chat
Set specific boundaries. Be professional with clients ("Formal Mode") and relaxed with the group chat ("Roast Mode").

### 🔍 Search Your DMs
Ask Raiden anything: "What restaurant did Mike recommend?" or "Does Sarah seem interested?". It's a search engine for your social life.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js, React, TypeScript, TailwindCSS |
| **Backend** | Python, FastAPI, WebSockets |
| **Desktop** | Electron |
| **Browser Automation** | Playwright |
| **AI** | OpenAI GPT-4 |
| **Auth & Database** | Supabase |
| **Payments** | DodoPayments |

---

## 📁 Project Structure

```
raiden/
├── backend/          # Python FastAPI backend
├── frontend/         # Next.js React frontend
├── electron/         # Electron main process
├── worker/           # Background workers (Instagram automation)
├── supabase/         # Edge functions
├── landing/          # Marketing website
└── assets/           # Logos and icons
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- npm or yarn

### Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/raidenai-site/raiden.git
   cd raiden
   ```

2. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

4. **Install Electron dependencies**
   ```bash
   cd electron
   npm install
   cd ..
   ```

5. **Set up environment variables**
   - Copy `.env.example` to `.env` and fill in your keys
   - Copy `frontend/.env.local.template` to `frontend/.env.local` and fill in Supabase keys

6. **Run in development mode**
   ```bash
   dev.bat
   ```

### Building for Production

```bash
build.bat
```

This will create an installer in `dist-electron/`.

---

## 📥 Download

Get the latest release for Windows:

**[⬇️ Download Raiden Setup](https://github.com/raidenai-site/raiden/releases/download/v1.0.0/Raiden.Setup.1.0.0.exe)**

---

## 💰 Pricing

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0 | 50 AI messages/day, 2 chats with AI |
| **Pro** | $10/mo | 200+ messages/day, unlimited chats, priority support |

---

## 📄 License

This project is proprietary software. See [LICENSE.txt](LICENSE.txt) for details.

---

## 📧 Support

Need help? Contact us at **support@raidenai.site**

---

<p align="center">
  Made with ⚡ by the Raiden team
</p>
