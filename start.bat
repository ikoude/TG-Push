@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ╔══════════════════════════════════════╗
echo ║     TG·Push v3 启动中...          ║
echo ╚══════════════════════════════════════╝

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 v18+
    echo    安装方式: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo ⚠️ Node.js 版本过低，需要 v18+
    pause
    exit /b 1
)

echo ✅ Node.js 检测通过

:: 首次运行自动安装依赖
if not exist "node_modules" (
    echo.
    echo 📦 首次运行，正在安装依赖...
    call npm install --production

    if %errorlevel% neq 0 (
        echo.
        echo ❌ 依赖安装失败，请检查网络或代理设置
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
)

echo.
echo 🚀 启动服务...
echo.

node src/server.js

pause
