#!/bin/sh
set -u
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -x /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node ]; then
  node_bin=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
else
  printf '%s\n' '请先通过图形安装器安装 Node.js LTS：https://nodejs.org/en/download'
  if [ "$(uname -s)" = Darwin ]; then open https://nodejs.org/en/download; else xdg-open https://nodejs.org/en/download 2>/dev/null || true; fi
  exit 1
fi
export CODEX_PROFILE_INTERACTIVE=1
"$node_bin" "$script_dir/deploy-global-profile.mjs" "$@"
result=$?
if [ "$result" -eq 0 ] && [ "$(uname -s)" = Darwin ]; then
  "$script_dir/install-codex-profile-service-mac.sh" "$@"
  result=$?
fi
if [ "$result" -eq 0 ]; then
  printf '\n%s\n' '全局安装和检查通过。所有工作区共享；重新登录后常驻服务会自动运行。'
else
  printf '\n%s\n' '安装未完成，请保留窗口中的错误信息；没有把失败当作成功。'
fi
printf '%s' '按回车关闭。'
read -r close_response
exit "$result"
