// electron/main.js
// Main process - spawns Python backend and creates the app window

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const treeKill = require('tree-kill');

// Determine if we're in development or production
const isDev = !app.isPackaged;

// Set persistent user data path for dev mode
// This ensures localStorage persists across restarts
if (isDev) {
    const devUserDataPath = path.join(__dirname, '..', '.electron-data');
    app.setPath('userData', devUserDataPath);
}

let mainWindow = null;
let tray = null;
let pythonProcess = null;
let frontendProcess = null;  // Only used in development

// Paths
const getResourcePath = (relativePath) => {
    if (isDev) {
        return path.join(__dirname, '..', relativePath);
    }
    return path.join(process.resourcesPath, relativePath);
};

// ==================
// PYTHON BACKEND
// ==================
function startPythonBackend() {
    return new Promise((resolve, reject) => {
        console.log('🐍 Starting Python backend...');

        let pythonExe;
        let args;
        let cwd;

        if (isDev) {
            // Development: use python directly
            pythonExe = 'python';
            args = ['run.py'];
            cwd = path.join(__dirname, '..');
        } else {
            // Production: use bundled exe
            // PyInstaller creates: backend/raiden-backend/raiden-backend.exe
            pythonExe = path.join(process.resourcesPath, 'backend', 'raiden-backend', 'raiden-backend.exe');
            args = [];
            cwd = path.join(process.resourcesPath, 'backend', 'raiden-backend');
        }

        pythonProcess = spawn(pythonExe, args, {
            cwd: cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                PYTHONUNBUFFERED: '1'
            }
        });

        pythonProcess.stdout.on('data', (data) => {
            console.log(`[Python] ${data.toString().trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`[Python Error] ${data.toString().trim()}`);
        });

        pythonProcess.on('error', (err) => {
            console.error('Failed to start Python:', err);
            reject(err);
        });

        pythonProcess.on('exit', (code) => {
            console.log(`Python exited with code ${code}`);
            pythonProcess = null;
        });

        // Wait for backend to be ready
        waitForBackend(resolve, reject);
    });
}

function waitForBackend(resolve, reject, attempts = 0) {
    const maxAttempts = 30; // 30 seconds timeout

    const req = http.get('http://127.0.0.1:8000/auth/status', (res) => {
        console.log('✅ Python backend is ready!');
        resolve();
    });

    req.on('error', () => {
        if (attempts >= maxAttempts) {
            reject(new Error('Backend failed to start'));
            return;
        }
        setTimeout(() => waitForBackend(resolve, reject, attempts + 1), 1000);
    });

    req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(() => waitForBackend(resolve, reject, attempts + 1), 500);
    });
}

// ==================
// FRONTEND (Dev Server - only used in development)
// ==================
function startFrontend() {
    // In production, we serve static files directly - no server needed
    if (!isDev) {
        console.log('⚛️ Production mode: using static frontend files');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        console.log('⚛️ Starting Next.js dev server...');

        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const cwd = path.join(__dirname, '..', 'frontend');

        frontendProcess = spawn(npm, ['run', 'dev'], {
            cwd: cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            windowsHide: true
        });

        frontendProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Frontend] ${output.trim()}`);
            // Next.js is ready when it shows the URL
            if (output.includes('ready') || output.includes('3000')) {
                resolve();
            }
        });

        frontendProcess.stderr.on('data', (data) => {
            console.error(`[Frontend Error] ${data.toString().trim()}`);
        });

        frontendProcess.on('error', (err) => {
            console.error('Failed to start Frontend:', err);
            reject(err);
        });

        // Timeout fallback - assume ready after 10 seconds
        setTimeout(resolve, 10000);
    });
}

// ==================
// MAIN WINDOW
// ==================
function createWindow() {
    const iconPath = isDev
        ? path.join(__dirname, '..', 'logo.png')
        : path.join(process.resourcesPath, '..', 'logo.png');

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        icon: iconPath,
        title: 'Raiden',
        backgroundColor: '#0a0a0a',
        show: false, // Don't show until ready
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Remove default menu bar
    mainWindow.setMenu(null);
    mainWindow.setAutoHideMenuBar(true);

    // Load the frontend
    if (isDev) {
        // Development: use dev server
        mainWindow.loadURL('http://localhost:3000');
    } else {
        // Production: load static files directly
        const indexPath = path.join(process.resourcesPath, 'frontend', 'out', 'index.html');
        console.log('📂 Loading frontend from:', indexPath);
        mainWindow.loadFile(indexPath);
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        console.log('🎉 Raiden is ready!');
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Open DevTools in development
    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// ==================
// SYSTEM TRAY
// ==================
function createTray() {
    const iconPath = isDev
        ? path.join(__dirname, '..', 'logo.png')
        : path.join(process.resourcesPath, '..', 'logo.png');

    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Raiden',
            click: () => {
                mainWindow.show();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Raiden - AI Instagram Assistant');
    tray.setContextMenu(contextMenu);

    // Click to show window
    tray.on('click', () => {
        mainWindow.show();
    });
}

// ==================
// APP LIFECYCLE
// ==================
app.whenReady().then(async () => {
    console.log('🚀 Starting Raiden Desktop...');

    // Remove application menu globally
    Menu.setApplicationMenu(null);

    try {
        // Start backend first
        await startPythonBackend();

        // Start frontend
        await startFrontend();

        // Create window and tray
        createWindow();
        createTray();

    } catch (error) {
        console.error('Failed to start Raiden:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    // Don't quit on macOS (though we're Windows-only)
    if (process.platform !== 'darwin') {
        // Don't quit - we're in tray mode
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

let isCleanedUp = false;

app.on('before-quit', async (e) => {
    // If we have already cleaned up, let the quit proceed
    if (isCleanedUp) return;

    // Prevent default quit to allow async cleanup
    e.preventDefault();
    app.isQuitting = true; // Signal that we are indeed quitting
    console.log('🛑 Cleanup started...');

    const killPromises = [];

    // Helper to kill process tree promise
    const killProcessTree = (pid, name) => {
        return new Promise((resolve) => {
            if (!pid) {
                resolve();
                return;
            }
            console.log(`Killing ${name} (PID: ${pid})...`);
            treeKill(pid, 'SIGKILL', (err) => {
                if (err) console.error(`Error killing ${name}:`, err);
                else console.log(`✅ ${name} stopped.`);
                resolve();
            });
        });
    };

    if (pythonProcess) {
        killPromises.push(killProcessTree(pythonProcess.pid, 'Python Backend'));
    }

    // Only kill frontend in development (production uses static files)
    if (isDev && frontendProcess) {
        killPromises.push(killProcessTree(frontendProcess.pid, 'Frontend'));
    }

    // Force safety timeout of 3 seconds
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for kills or timeout
    await Promise.race([Promise.all(killPromises), timeout]);

    console.log('✅ Cleanup finished, quitting...');
    isCleanedUp = true;
    app.quit();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
