#!/bin/sh
set -u
profile_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$profile_source/scripts/deploy-codex-profile-mac.sh"
deploy_result=$?
if [ "$deploy_result" -eq 0 ]; then
  printf '\n%s\n' '全局配置和右键部署入口已安装。请在 Codex 中确认 Hook 信任；以后所有工作区共享同一套配置。'
else
  printf '\n%s\n' '安装失败，没有宣称部署完成。若无法访问私有 Skill 库，请先完成 gh auth login 和 gh auth setup-git。'
fi
printf '\n%s' '按回车关闭。'
read -r close_response
exit "$deploy_result"
