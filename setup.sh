#!/bin/bash

# EPUB 转 PDF 工具 - 安装脚本

echo "====== EPUB 转 PDF 工具安装脚本 ======"
echo "此脚本将帮助您解决常见的安装问题"
echo ""

# 创建目录
echo "创建必要的目录..."
mkdir -p uploads outputs
mkdir -p public/css public/js

# 修复npm缓存权限
echo "修复npm缓存目录权限..."
if [ -d "$HOME/.npm" ]; then
    sudo chown -R $(whoami) $HOME/.npm
fi

# 修复puppeteer缓存目录权限
echo "修复puppeteer缓存目录权限..."
if [ ! -d "$HOME/.cache/puppeteer" ]; then
    sudo mkdir -p $HOME/.cache/puppeteer
fi
sudo chown -R $(whoami) $HOME/.cache/puppeteer

# 检查Chrome浏览器
echo "检查是否安装Chrome浏览器..."

CHROME_FOUND=false
CHROME_PATHS=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"  # macOS
    "/usr/bin/google-chrome"                                        # Linux
    "/usr/bin/chromium-browser"                                     # Linux Chromium
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"    # Windows
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"  # Windows 32bit
)

for path in "${CHROME_PATHS[@]}"; do
    if [ -f "$path" ]; then
        CHROME_FOUND=true
        echo "已找到Chrome浏览器: $path"
        break
    fi
done

if [ "$CHROME_FOUND" = false ]; then
    echo "警告: 未找到Chrome浏览器。您需要安装Chrome才能使用此工具。"
    echo "您可以从 https://www.google.com/chrome/ 下载Chrome浏览器。"
fi

# 安装依赖
echo "安装Node.js依赖..."
PUPPETEER_SKIP_DOWNLOAD=true npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "安装成功完成！"
    echo ""
    echo "现在您可以通过以下命令启动服务："
    echo "npm start"
    echo ""
    echo "然后在浏览器中访问: http://localhost:3000"
else
    echo ""
    echo "安装过程中出现错误，请检查上面的日志信息。"
    echo "您可能需要手动运行: sudo npm install"
fi 