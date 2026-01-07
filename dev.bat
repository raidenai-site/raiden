@echo off
REM Raiden Desktop - Development Mode Launcher
REM Runs both backend and frontend in dev mode, then launches Electron

echo ======================================
echo   RAIDEN DESKTOP - DEV MODE
echo ======================================
echo.

REM Check if electron is installed
if not exist "electron\node_modules" (
    echo [SETUP] Installing Electron dependencies...
    cd electron
    call npm install
    cd ..
)

REM Check if frontend node_modules exists
if not exist "frontend\node_modules" (
    echo [SETUP] Installing Frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

echo [INFO] Starting Electron in development mode...
echo [INFO] This will auto-start Python backend and Next.js frontend
echo.

cd electron
call npm start
cd ..
