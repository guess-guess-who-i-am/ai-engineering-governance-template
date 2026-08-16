# 设计参考目录

本仓库自己的视觉权威始终是根目录 `DESIGN.md`。`design/catalog.json` 是可搜索的外部参考索引，用于寻找设计语言，不会自动覆盖项目视觉规范。

目录固定到 `VoltAgent/awesome-design-md` 的一个 MIT 许可 commit，并收录其全部 70+ 个 `DESIGN.md`。每条记录保存产品类型、原始 URL、仓库内路径、commit 和许可证。`x.ai` 指 xAI 的参考；它不是 ZGI。当前固定来源没有 `zgi.ai`，因此目录不会伪造这一项。

```powershell
./scripts/search-design-references.ps1 -Query voice
./scripts/search-design-references.ps1 -ProductType developer-tools
./scripts/install-design-reference.ps1 -Id elevenlabs -TargetRoot ../my-project
```

安装结果位于目标项目的 `design-references/<id>/`，包括参考 `DESIGN.md` 和 `provenance.json`。安装不会复制字体、图片或商标资产，也不会自动替换项目根 `DESIGN.md`。采用参考前应提炼适合自己的 tokens、交互和可访问性规则，记录修改，并确认专有字体使用开源替代品。

本地镜像更新后先运行 `build-design-catalog.ps1`，审查目录差异、许可证和视觉内容，再提交新 catalog。不得把来源 commit 与实际内容分开更新。
