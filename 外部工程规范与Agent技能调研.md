# 外部工程规范与 Agent Skills 调研

调研日期：2026-08-13

## 1. 核心结论

这批链接并不是同一类产品，而是共同展示了 AI 编程工程正在形成的一套“可读规范 → 按需技能 → 可执行验证”体系：

| 层次 | 代表项目 | 主要作用 | 是否直接执行 |
|---|---|---|---|
| 视觉上下文 | getdesign / `DESIGN.md` | 告诉 Agent 页面应该长什么样、哪些视觉选择必须保持一致 | 否，主要作为生成上下文 |
| 专项技能 | Taste Skill、Apple Design Skill | 告诉 Agent 面对某类任务时应如何判断、实施和自检 | 部分；主要是指令，也可附脚本 |
| 仓库常驻规则 | LUAS `AGENTS.md` | 规定仓库结构、权威文件、编辑边界、验证预算和工作方式 | 规则本身不执行 |
| 领域语义模型 | LUAS `CONTEXT.md` | 固定术语、所有权、边界和概念关系，防止 Agent 在大项目中语义漂移 | 否，但约束所有设计决策 |
| 可执行工程门禁 | LUAS Skills + scripts | 把架构、安全、契约、供应链等规则变成确定性检查 | 是 |
| 可执行行为文档 | Kest `.flow.md` | 把 API 文档、业务流程和断言合并为可运行测试 | 是 |

最值得借鉴的不是某一条提示词，而是这个分层原则：

1. `AGENTS.md` 放始终适用的仓库导航和硬边界。
2. `CONTEXT.md` 放稳定的领域词汇、所有权和概念关系。
3. `SKILL.md` 放仅在特定任务触发的完整工作流。
4. `DESIGN.md` 放项目当前的视觉系统，不承担通用工程规则。
5. `scripts/` 或 `.flow.md` 把可机械判断的要求变成真实门禁。

## 2. getdesign.md 与 Awesome DESIGN.md

### 它是什么

getdesign.md 是面向 AI coding agents 的设计系统目录。对应的开源仓库是 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)，仓库将公开网站的可观察设计语言整理为一个个 `DESIGN.md`。截至调研时，仓库 README 标示 73 份设计分析，GitHub 元数据约 10.8 万 stars，MIT License。

使用方式很直接：

```bash
npx getdesign@latest add elevenlabs
```

安装后，把 `DESIGN.md` 放进项目，再要求 Codex、Claude Code、Cursor 等依据它完成 UI。

### ElevenLabs 的 `DESIGN.md` 实际包含什么

仓库中的文件不是一句“仿 ElevenLabs”，而是一份约 20 KB 的结构化视觉上下文，包括：

- YAML frontmatter：版本、名称、描述、颜色 token、字体 token、圆角、间距和组件 token。
- 视觉原则：品牌气质、颜色使用范围、字体层级、留白哲学和深度表达。
- 组件规范：导航、按钮、Hero、卡片、音频波形、定价、表单、标签、CTA、Footer。
- Do / Don't：哪些视觉行为允许，哪些会破坏品牌语言。
- 响应式行为：断点、布局变化、触控目标。
- 可访问性和实现提示。

当前仓库文件将 ElevenLabs 描述为浅色、编辑感的体系：off-white 画布、暖黑文字、Waldenburg Light 风格的轻衬线标题、Inter 正文、柔和的 pastel gradient orbs，并明确反对饱和 CTA 和开发者工具式暗色画布。

### 一个重要的版本风险

getdesign 页面摘要写的是 “Dark cinematic UI, audio-waveform aesthetics”，但当前 GitHub `DESIGN.md` 的核心规范与此明显冲突。页面与仓库至少存在文案或版本不同步。因此：

- 以实际安装到项目的 `DESIGN.md` 为准。
- 应把 `version`、来源 URL、抓取日期或 commit 固定下来。
- 不应仅根据目录页的营销摘要做实现。

### 它适合什么、不适合什么

适合：快速建立视觉方向、减少 Agent 每次重新猜测颜色/字体/组件风格、制作特定品牌语言的原型。

不适合：直接当作官方品牌规范。仓库明确声明这是基于公开可观察模式的独立分析，并非 ElevenLabs 官方授权；其中部分字体替代、数值和模式属于整理者推断。

## 3. Taste Skill

### 它是什么

[Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) 是一组可移植的 Agent Skills，目标是减少 AI 前端常见的模板味和“AI slop”。截至调研时约 7.6 万 stars，MIT License。

安装方式遵循 Agent Skills 生态：

```bash
npx skills add https://github.com/Leonxlnx/taste-skill
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

也可直接把某个 `SKILL.md` 复制进仓库或粘贴给 Codex。

### 它不是一个 Skill，而是一组工作模式

- `design-taste-frontend`：默认 v2，适合 landing page、portfolio 和 redesign。
- `gpt-taste`：面向 GPT / Codex 的更严格版本，提高布局差异和动效约束。
- `image-to-code`：先生成视觉参考，再分析并实现。
- `redesign-existing-projects`：先审计已有 UI，再重构。
- `high-end-visual-design`、minimalist、brutalist：明确视觉方向后的风格技能。
- `output-skill`：约束 Agent 不交付占位符、遗漏区块和半成品。
- web/mobile/brandkit image generation skills：只生成参考图，不直接输出代码。

### v2 的主要方法

它把设计任务变成一套显式推理过程：

1. 先读 brief，判断行业、受众、气质、布局、密度与动效需要。
2. 输出一行 `Design Read`，避免 Agent 静默套默认模板。
3. 设置三个控制旋钮：`DESIGN_VARIANCE`、`MOTION_INTENSITY`、`VISUAL_DENSITY`。
4. 判断应使用 Material、Fluent、Carbon、Polaris、Atlassian、Primer、GOV.UK、USWDS、Radix、shadcn 等真实设计系统，还是使用自定义审美语言。
5. 对字体、颜色、卡片、布局、内容密度、移动端、动效、深色模式建立硬规则。
6. 改版任务必须先审计品牌 token、IA、内容块、SEO、可访问性与分析事件。
7. 最终运行完整 Pre-flight Checklist。

它还给出相当具体的工程建议，例如 Tailwind v4、Motion、`100dvh`、CSS Grid、Motion Values、`prefers-reduced-motion`、WCAG 对比度检查，以及 GSAP sticky stack / horizontal pan 的参考骨架。

### 价值与局限

价值在于它专门纠正模型的高频默认偏差：所有 Hero 居中、每节都有 eyebrow、重复卡片阵列、AI 紫色渐变、无目的动效、移动端靠碰运气、重设计时破坏 SEO 和品牌资产。

但它不是普适设计真理。若干规则是作者基于实践总结的强启发式，例如精确的 section 比例、Hero 字数、eyebrow 数量、禁用某些图标库、完全禁用破折号等，并没有在仓库中给出科学或行业标准依据。正确用法是：

- 把 WCAG、响应式、减少动态效果等标准性要求作为硬门禁。
- 把反模板偏差规则作为默认启发式，允许品牌或任务 brief 覆盖。
- 不要把一个面向营销站的 Skill 强行用于 dashboard、数据表或复杂产品流；该 Skill 自己也明确排除了这些场景。

## 4. Emil Kowalski 的 Apple Design Skill

### 它是什么

[emilkowalski/skills](https://github.com/emilkowalski/skills) 是面向设计师和工程师的 Skill 集合，包含动画实现、动画审查、原型、UI 库选择等多个专项 Skill。截至调研时约 2.9 万 stars，MIT License。

其中 [apple-design/SKILL.md](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) 把 Apple 的界面设计和 WWDC 动效思想翻译成 Web 实现原则。它不是让页面“看起来像苹果官网”的皮肤包，而是讲交互为何会具有物理感。

### 核心规范

- Response：按下瞬间反馈，而不是等待 click/release。
- Direct manipulation：拖拽过程与指针 1:1 连续对应。
- Interruptibility：动画随时可被抓住、反向或接管。
- Springs：优先使用可中断、速度感知的弹簧，而非固定时间曲线。
- Velocity handoff：手势结束后继承用户释放速度。
- Momentum projection：根据速度预测目标，而非只看当前位置。
- Spatial consistency：进入和退出路径对称，动画从触发位置产生。
- Rubber-banding：边界处提供逐渐增强的阻力。
- Frame smoothness：避免主线程卡顿和逐帧 React state 更新。
- Materials and depth：透明、模糊和层级用于表达空间关系，而非纯装饰。
- Multimodal feedback：适当组合视觉、声音、触觉。
- Accessibility：支持 reduced motion。
- Typography：光学字号、tracking、leading。

### 对 Codex 的实际价值

这个 Skill 最适合手势驱动组件、拖拽、Sheet、Swipe、Carousel、共享元素、弹簧动画和交互动效审查。它提供的是“行为模型”，比简单指定 `duration: 0.3` 更能帮助 Agent 写出自然且可中断的实现。

需要注意：它是作者对 Apple WWDC 内容的整理和 Web 翻译，不是 Apple 官方 HIG 的替代品。涉及平台合规时仍应以 Apple 官方 HIG 和 WCAG 为最终权威。

## 5. Kest Flow

### 它是什么

[kest-labs/kest](https://github.com/kest-labs/kest) 是一个开源、CLI-first、Markdown-native 的 API 测试平台。它不是 Codex Skill，而是可以被 Codex 读写和执行的工程工具。仓库包含：

- `cli/`：Go CLI。
- `api/`：协作平台后端与 AI diagnosis。
- `web/`：Next.js 控制台。
- `.kest/flow/`：可执行的 `.flow.md` 测试。
- `docs-site/`：中英文文档。
- API/Web 各自的 `.agent/skills` 和 `AGENTS.md`。

### Flow 的意义

`.flow.md` 将下面几种资产合并在同一个 Git 文件中：

- 人能读的业务流程文档。
- HTTP 请求定义。
- 响应字段捕获和跨步骤变量传递。
- 业务断言与性能断言。
- 重试、依赖边、执行步骤和 Mermaid 流程图。
- 本地、CI 或 Cloud 执行入口。

因此它实现的是 documentation as executable specification，而不只是“用 Markdown 写文档”。典型命令包括：

```bash
kest init
kest get /api/users -a "status==200"
kest post /api/login -d '{"user":"admin"}' -c "token=data.token"
kest run auth.flow.md
```

还包括 `kest why` 失败诊断、`kest suggest`、`kest gen`、历史记录、snapshot、replay、diff、mock、watch 与 CLI/Web 同步。

### 对 Codex 工作流的价值

Codex 很擅长生成 Markdown 和理解 HTTP，因此可以：

1. 根据 API 契约生成 `.flow.md`。
2. 实际运行 Flow，而非只写单元测试框架。
3. 读取失败步骤、请求、响应和断言，定位第一个业务偏差。
4. 把回归用例和文档一起提交，减少文档与测试分离。

### 风险与核验结果

仓库 README 声称 Apache 2.0，但仓库 API 没有识别到 license，根目录 `LICENSE` 也返回 404。若要在商业模板中分发或嵌入，应先让项目维护者补齐或确认许可证；不能只依据 README 的一句说明。

此外，项目当前规模和社区采用度远低于前三个设计仓库，适合先做小范围试点，不应未经验证就替代成熟 API 测试体系。可以将它作为端到端业务 Flow 层，与语言原生单元/集成测试并存。

## 6. LUAS：最完整的 Codex 工程模板案例

### 它是什么

[agicto/luas](https://github.com/agicto/luas) 自称 AI-era full-stack application scaffold / starter kit，而不是已完成产品，也不只是一个框架内核。它由 Go API、Next.js Web、Vite/TanStack Admin、共享 HTTP contracts、文档、测试和 Agent guidance 组成。

仓库 stars 很少，不能用流行度证明成熟度；但就“如何组织 Codex 可消费的工程规则”而言，它是这批材料里最系统的案例。

### `CONTEXT.md`：领域模型与统一词汇

`CONTEXT.md` 是全仓库 canonical glossary。它不是项目简介，而是显式定义：

- Luas、downstream app、scaffold、starter、core、feature、module、seam、contract。
- 数据库 runtime、cache capability、auth session、browser gateway、API key scope、permission key。
- notification / delivery、asset / stored object、setting definition / override、usage metric / event / counter / quota、webhook event / delivery。
- 各概念之间的 Relationships。
- 容易混淆术语的 Flagged Ambiguities。

这对 Agent 极其重要，因为大型工程最常见的问题之一不是语法错误，而是“同一个词在不同模块代表不同东西”和“所有权被放错层”。`CONTEXT.md` 把这些语义争议提前冻结。

### `AGENTS.md`：常驻操作系统

根 `AGENTS.md` 规定：

- 仓库拓扑与各 deployable unit 的边界。
- Fast Task Routing：先读 diff、最近实现和测试，只在需要时扩展上下文。
- Codex 的 Skill 选择规则：发现阶段只加载 metadata，选中后才读完整 `SKILL.md`。
- Authority Map：术语冲突看 `CONTEXT.md`，HTTP 行为看 owning contract，本地实现看最近的 `AGENTS.md`。
- Repository Rules：禁止 API 和 browser shell 共享源码、数据库兼容目标、品牌命名等。
- Verification Budget：按改动范围选择最窄但足够的验证，不无脑运行全仓库检查。

这是很好的 Codex 用法：让 Agent 先路由，再渐进加载上下文，避免把整个仓库文档塞进 prompt。

### `.agents/skills`：按需工作流

根目录包含：

- `contract-evolution`：演进共享 HTTP 行为。
- `domain-modeling`：解决全局词汇和所有权。
- `downstream-app-extraction`：从 scaffold 提取下游应用并检查污染。
- `grill-before-build`：高影响决策在构建前进行质询。
- `luas-code-review`：明确的 diff / PR 审查。
- `luas-framework-review`：全框架审计。
- `pr-description-writer`：生成 PR 描述。
- `systematic-debugging`：系统化调试。
- `tdd-regression`：回归驱动的 TDD。
- `verification-before-completion`：完成前选择正确证据。

API 和 Web 目录还有本地 Skills，使规则靠近实际所有者。

### 规范如何变成插件式能力

LUAS 的 Skills 不是只有 `SKILL.md`：

- `agents/openai.yaml` 放 UI / policy metadata。
- `references/`、`examples/` 放可选长材料，避免核心 Skill 过大。
- `scripts/` 放确定性重复检查。
- `list-skills.sh`、`validate-skill.sh` 检查 Skill 自身结构。
- `make agent-check` 作为快速 Agent guidance 门禁。

`luas-framework-review/scripts/` 包含大量真实 guard，例如：

- API、认证、API key、权限、数据库、cache、asset、notification、setting、usage、webhook 边界。
- CI、依赖与容器供应链。
- 错误契约、路由目录、敏感遥测、Web 安全、Web 性能、UI primitive 边界。
- 脚手架架构报告和 starter catalog 检查。

这使 Skill 从“建议 Agent 注意”升级为“Agent 必须运行并通过的工程能力”。

### Skill 编写规范

LUAS 自身还规定了 Skill 的工程标准：

- `name` 唯一、kebab-case、最多 64 字符。
- `description` 最多 1024 bytes，推荐不超过 200 bytes。
- `SKILL.md` 最多 200 行；教程和大例子移入 `references/` 或 `examples/`。
- Frontmatter 只放 `name` 和 `description`；UI / policy metadata 放 `agents/openai.yaml`。
- 确定性重复检查放进 `scripts/`。
- 新 Skill 要写明确触发和非触发示例，测试代表性 prompts，并更新最近的 `AGENTS.md`。

这套规范非常值得直接移植到自己的工程模板。

## 7. 六个项目之间的关系

可以把它们放进一条从意图到证据的链路：

```text
用户需求
  ↓
AGENTS.md：当前仓库允许怎样工作、去哪里找权威
  ↓
CONTEXT.md：需求涉及的概念究竟是什么、归谁所有
  ↓
SKILL.md：这类任务的专项判断与实施流程
  ↓
DESIGN.md：如果涉及 UI，当前项目要遵循什么视觉语言
  ↓
代码与 contracts
  ↓
scripts / .flow.md：把可检查的要求运行起来
  ↓
完成证据
```

对应到你给的链接：

- getdesign 解决“生成出来应该像什么”。
- Taste Skill 解决“如何避免通用 AI 前端偏差”。
- Apple Design Skill 解决“交互和动效为什么有物理感”。
- Kest 解决“业务/API 文档如何真正执行”。
- LUAS Skills 解决“特定工程任务如何按需加载流程”。
- LUAS `CONTEXT.md` 解决“大型工程里术语、边界和所有权如何不漂移”。

## 8. 对工程模板的采用建议

### 第一优先级：直接采用结构思想

建议模板根目录至少包含：

```text
AGENTS.md
CONTEXT.md
DESIGN.md                 # 仅 UI 项目需要
contracts/
.agents/
  skills/
    README.md
    <skill>/
      SKILL.md
      agents/openai.yaml  # 可选
      references/         # 可选
      examples/           # 可选
      scripts/            # 可选
tests/flows/              # 或 .kest/flow/
```

### 第二优先级：先做少量高价值 Skills

不应一开始复制几十个 Skill。优先建设：

1. `systematic-debugging`：定位第一处信息流偏差。
2. `verification-before-completion`：要求用可运行证据证明完成。
3. `contract-evolution`：保护前后端契约和兼容策略。
4. `frontend-design` 或项目自有设计 Skill。
5. `code-review`：只在明确审查任务触发。

### 第三优先级：把规则分为两类

- 可解释但难机械判断：放进 `SKILL.md`，例如品牌气质、信息层级、所有权判断。
- 可确定性检查：必须放进 script/test/flow，例如依赖边界、错误码格式、路由清单、对比度、断言、构建、类型检查。

如果一条规则能够被脚本稳定判断，却只写在提示词中，它最终会被遗漏。

### 第四优先级：不要原样照搬强审美规则

Taste Skill 和 DESIGN.md 都应作为可覆盖的项目默认值。应保留：

- brief-first、audit-first、responsive explicit、a11y、reduced motion、dependency verification。
- 颜色、圆角、布局、动效必须保持系统一致。

应项目化处理：

- 固定的 Hero 字数、section 数量、eyebrow 比例。
- 对某个图标库或标点的绝对禁令。
- 来自第三方网站观察而非官方规范的品牌数值。

## 9. 最终判断

这些材料确实包含大量“规范、插件、技巧和 Codex 使用方法”，但成熟度不同：

- **最适合提供视觉上下文：** Awesome DESIGN.md。
- **最适合纠正 AI 前端默认偏差：** Taste Skill。
- **最适合学习高质量交互动效：** Apple Design Skill。
- **最适合把 Markdown 变成真实测试：** Kest Flow。
- **最适合学习 Codex 工程治理架构：** LUAS 的 `AGENTS.md + CONTEXT.md + Skills + scripts`。

如果只选一个作为“工程模板探索”的主要研究对象，应选 LUAS；如果要建设 UI 模板，则在 LUAS 式治理骨架上叠加项目自己的 `DESIGN.md`，再按任务选择 Taste 或 Apple Design Skill。Kest 可以作为 API 业务 Flow 的可执行证据层试点接入。

## 10. 主要来源

- [getdesign ElevenLabs 页面](https://getdesign.md/elevenlabs/design-md)
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
- [ElevenLabs DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/elevenlabs/DESIGN.md)
- [Taste Skill 官网](http://tasteskill.dev/)
- [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
- [Taste Skill v2](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md)
- [Emil Kowalski Skills](https://github.com/emilkowalski/skills)
- [Apple Design Skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md)
- [Kest Flow](https://www.kest.dev/flow)
- [kest-labs/kest](https://github.com/kest-labs/kest)
- [agicto/luas](https://github.com/agicto/luas)
- [LUAS CONTEXT.md](https://github.com/agicto/luas/blob/main/CONTEXT.md)
- [LUAS Agent Skills](https://github.com/agicto/luas/tree/main/.agents/skills)
- [LUAS AGENTS.md](https://github.com/agicto/luas/blob/main/AGENTS.md)
