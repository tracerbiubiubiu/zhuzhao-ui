#!/bin/bash
# API 类型生成链（主仓 01 号 §3.3 / 02 号 §5.3 处置#3，P4-W2 壳层件）：
#   主仓 make swag → docs/swagger.json（Swagger 2.0）
#   → swagger2openapi 转 OpenAPI 3.0（2026-09-21 拍板目标格式）
#   → openapi-typescript 生成 TS 类型 → src/api/__generated__/schema.d.ts
#
# 纪律（01 §3.3）：生成物不手改；后端契约批合入后同批再生成（pnpm codegen），
# 契约漂移在前端编译期报错（pnpm typecheck），不靠人记。
set -euo pipefail
cd "$(dirname "$0")/.."

ZHUZHAO_REPO="${ZHUZHAO_REPO:-../zhuzhao}"
SWAGGER="$ZHUZHAO_REPO/docs/swagger.json"
OUT="src/api/__generated__/schema.d.ts"

if [ ! -f "$SWAGGER" ]; then
  echo "✗ 未找到 $SWAGGER —— 先在主仓执行 make swag（或设 ZHUZHAO_REPO=<主仓路径>）"
  exit 1
fi

TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
OPENAPI="$TMPDIR_LOCAL/openapi.json"

echo "── ① Swagger 2.0 → OpenAPI 3.0（swagger2openapi $(pnpm exec swagger2openapi --version 2>/dev/null | head -1)）"
pnpm exec swagger2openapi "$SWAGGER" -o "$OPENAPI"

echo "── ② openapi-typescript → $OUT"
pnpm exec openapi-typescript "$OPENAPI" -o "$OUT"

echo "✅ 类型已生成：${OUT}（int64 ID 已按后端契约序列化为 string）"
