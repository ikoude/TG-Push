#!/bin/bash
# TG·Push 启动脚本 (Mac/Linux)

cd "$(dirname "$0")"

echo "╔══════════════════════════════════════╗"
echo "║     TG·Push v3 启动中...          ║"
echo "╚══════════════════════════════════════╝"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 v18+"
    echo "   安装方式: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ] 2>/dev/null; then
    echo "⚠️  Node.js 版本过低 (v$(node -v))，需要 v18+"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# 首次运行自动安装依赖
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 首次运行，正在安装依赖..."
    npm install --production

    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ 依赖安装失败，请检查网络或代理设置"
        exit 1
    fi
    echo "✅ 依赖安装完成"
fi

echo ""
echo "🚀 启动服务..."
echo ""

node src/server.js
