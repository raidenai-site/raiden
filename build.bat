@echo off
REM Raiden Desktop - Full Build Script for Windows
REM This script builds the Python backend and Electron app

echo ======================================
echo   RAIDEN DESKTOP - BUILD SCRIPT
echo ======================================
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    exit /b 1
)

REM Check for Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    exit /b 1
)

echo [1/5] Installing Python dependencies...
pip install pyinstaller --quiet
if errorlevel 1 (
    echo [ERROR] Failed to install PyInstaller
    exit /b 1
)

echo [2/5] Building Python backend with PyInstaller...
pyinstaller raiden.spec --distpath dist-backend --noconfirm
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed
    exit /b 1
)

echo [3/5] Building Next.js frontend...
cd frontend
call npm install
call npm run build
cd ..

echo [4/5] Installing Electron dependencies...
cd electron
call npm install
cd ..

echo [5/5] Building Electron installer...
cd electron
call npm run build
cd ..

echo.
echo ======================================
echo   BUILD COMPLETE!
echo ======================================
echo.
echo Installer is located in: dist-electron\
echo.
pause
