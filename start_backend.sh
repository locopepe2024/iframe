#!/bin/bash

# 阿里云服务不走代理（避免PAC配置被Python忽略）
# macOS系统代理会被requests库读取，但PAC规则不会被解析
# 显式设置NO_PROXY确保阿里云域名直连
export NO_PROXY="*.aliyuncs.com,localhost,127.0.0.1"
export no_proxy="*.aliyuncs.com,localhost,127.0.0.1"

echo "========================================"
echo "Starting Backend (FastAPI)..."
echo "Port: 17177"
echo "Proxy Bypass: *.aliyuncs.com"
echo "========================================"

# 确保在项目根目录
cd "$(dirname "$0")"

# Prefer the repository venv created by `npm run predev`, while still making
# the direct launcher usable on a machine that has a compatible system Python.
if [ -x ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
else
    echo "Python 3 is required. Run npm run predev first."
    exit 1
fi

if ! "$PYTHON_BIN" -c 'import uvicorn' >/dev/null 2>&1; then
    echo "uvicorn is not installed for $PYTHON_BIN. Run npm run predev first."
    exit 1
fi

# 启动 uvicorn
"$PYTHON_BIN" -m uvicorn src.apps.comic_gen.api:app --reload --port 17177 --host 0.0.0.0
