#!/bin/bash

# 获取当前脚本文件名
SCRIPT_NAME=$(basename "$0")

# 检查当前目录是否是Git仓库
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "错误：当前目录不是Git仓库"
    echo "请先运行: git init"
    exit 1
fi

# 添加所有文件（排除当前脚本）
echo "添加文件到暂存区..."
git add . -- ':!'"$SCRIPT_NAME"

# 检查是否有文件需要提交
if git diff --cached --quiet; then
    echo "没有文件需要提交"
    exit 0
fi

# 提交更改
echo "提交更改..."
git commit -m "自动提交: $(date '+%Y-%m-%d %H:%M:%S')"

# 推送到GitHub
echo "推送到GitHub..."
if git push origin main; then
    echo "✅ 提交和推送成功完成！"
else
    echo "尝试推送到master分支..."
    if git push origin master; then
        echo "✅ 提交和推送成功完成！"
    else
        echo "❌ 推送失败，请检查远程仓库配置"
        echo "可能需要设置上游分支: git push -u origin main"
        exit 1
    fi
fi