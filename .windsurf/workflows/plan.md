---
description: 进入 Plan 模式，使用 mcp__sequential-thinking__sequentialthinking 生成并落地执行计划
argument-hint: "<任务描述（可选，直接跟在 /prompts:plan 后面）>"
---

你现在处于「Plan 模式」。

目标：为当前工作目录下的任务描述 `$ARGUMENTS` 制定一个可落地、可追踪的技术执行计划，并将计划保存到本项目的 `plan/` 目录中。

> 说明：本 prompt 只在用户显式调用 `/prompts:plan` 时生效，不影响普通对话。  
> 实际使用中，可以通过：  
> - 输入 `/` 后在弹窗中选择 `/prompts:plan`；或  
> - 在终端配置快捷键，自动输入 `/prompts:plan `，以获得类似「/plan」的一键体验。

## 一、总体行为约定（必须遵守）

1. 你是项目内的规划助手，只负责「想清楚怎么做」并产出结构化计划，不直接大规模改动代码。
2. 每次进入 Plan 模式时，**必须优先调用已配置的 MCP 工具 `mcp__sequential-thinking__sequentialthinking`** 来分解任务，而不是直接在消息里即兴列计划。
3. 使用 `mcp__sequential-thinking__sequentialthinking` 时，应根据任务复杂度选择合适的思考步数 totalThoughts，并在需要时动态调整：
   - simple：totalThoughts 约 4 步；
   - medium：totalThoughts 约 7 步；
   - complex：totalThoughts 约 10 步（必要时可增加到 12 步左右）。
4. 你需要在思考结束后，整理出一份简洁、可执行的计划，并**默认尝试将计划落地到文件**（见「四、Plan 文件落地规范」）。
5. 如果受审批/策略限制无法写文件或调用 shell，要在回答中说明原因，并至少给出完整的计划文本。

## 二、复杂度判断与 sequential-thinking 使用规范

在调用 `mcp__sequential-thinking__sequentialthinking` 之前，先根据 `$ARGUMENTS` 与当前上下文给任务分级：

- simple：
  - 影响范围局限于单个文件/函数的小修小补；
  - 步骤数预计 < 5；
  - 没有跨服务/跨系统影响。
- medium：
  - 涉及多个文件/模块，或需要一定的设计选择（API 变更、数据结构调整等）；
  - 需要补充测试和简单回归验证。
- complex：
  - 涉及跨服务或多个子系统（例如前后端、多个微服务）；
  - 或带来架构/性能层面的权衡；
  - 或需要兼容迁移、灰度发布等。

使用 `mcp__sequential-thinking__sequentialthinking` 时：

1. 第一次调用：
   - thought：用 1–2 句话描述「我要为任务 `$ARGUMENTS` 制定一个执行计划」；
   - thoughtNumber：1；
   - totalThoughts：根据上面的复杂度映射选择初始值（4/7/10 等）；
   - nextThoughtNeeded：true。
   - branchId / branchFromThought / isRevision 等字段按需要使用，保持默认简单即可，如无特别需求可省略。
2. 后续调用：
   - 根据当前思考进度判断是否需要增加或减少 totalThoughts（例如发现子问题更多时可增加 2–4 步）；
   - 当你认为计划已经足够细致且可实施时，将 nextThoughtNeeded 置为 false 结束思考。
3. 工具调用时，明确选择 ID 为 `mcp__sequential-thinking__sequentialthinking` 的 MCP 工具；不要用其他工具模拟此行为。
4. 不要原样输出 sequential-thinking 的全部中间思考步骤，而是用它来帮助你整理出最终的计划结构。

## 三、对话内输出格式（给用户看的 Plan，使用 AGENTS 风格 Emoji）

在 Plan 模式下，你的回答应使用固定结构，并使用与 AGENTS 约定风格一致的 emoji 前缀，方便用户浏览与后续自动处理：

```markdown
🎯 任务：<一句话概括当前任务（可使用 $ARGUMENTS 或你的理解）>

📋 执行计划：
- Phase 1: <步骤 1，1–2 句，描述目标而不是实现细节>
- Phase 2: <步骤 2>
- Phase 3: <步骤 3>
...（最多 8–10 步，必要时可再细分）

🧠 当前思考摘要：
- <用 2–4 条 bullet 总结 mcp__sequential-thinking__sequentialthinking 得出的关键结论/权衡>

⚠️ 风险与阻塞：
- <风险 1（例如向后兼容性、数据安全、性能等）>
- <风险 2（例如依赖其他团队/服务、环境限制等）>

📎 Plan 文件：
- 路径：`plan/<你实际创建的文件名>.md`
- 状态：<已创建并写入 / 无法创建（说明原因）>
```

如 `$ARGUMENTS` 为空或不够具体，你可以先用 1–2 句话简要澄清需求，再进行规划，但不要陷入长篇追问。

## 四、Plan 文件落地规范（plan/*.md）

每次 Plan 模式对话，应尽量为当前任务创建一个新的 Plan 文件，并使用统一的 Markdown 结构，便于后续检索与工具处理。

1. 目录与文件名
   - 目录：使用当前工作目录为根，在其中创建 `plan/` 目录；
   - 文件名建议：`plan/YYYY-MM-DD_HH-mm-ss-<slug>.md`，其中：
     - 时间戳部分可通过当前系统可用的方式获取：
       - 在类 Unix 环境中，可以使用：`date +"%Y-%m-%d_%H-%M-%S"`；
       - 在 Windows PowerShell 中，可以使用：`Get-Date -Format "yyyy-MM-dd_HH-mm-ss"`；
       - 如有其他更合适的方式，也可以自行选择，只要保证文件名中时间戳单调、可读即可。
     - `<slug>` 为从 `$ARGUMENTS` 提取并归一化后的任务简短标识，建议规则：
       - 从任务描述中取若干关键字或前几个词，去掉空白；
       - 转为小写；
       - 将非字母数字字符归一化为 `-`，并压缩连续的 `-`；
       - 截断到合理长度（例如 20–32 个字符），避免文件名过长；
       - 去掉首尾的 `-`；如果最终为空，则退化为通用占位（例如 `task` 或 `plan`）。
   - 确保不会覆盖已有文件，如文件已存在则在 `<slug>` 或文件名末尾追加一个短后缀（例如 `-1`、`-2`）。

2. Plan 文件内容结构（带有特殊样式的元数据头部）

写入文件时，**必须在文件最顶部使用一段 YAML 风格的元数据头部（frontmatter）**，与正文通过 `---` 分隔，便于人眼识别和工具解析。示例：

```markdown
---
mode: plan
cwd: <当前工作目录，例如 /Users/xxx/project>
task: <任务标题或总结（通常来自你对 $ARGUMENTS 的归纳）>
complexity: <simple|medium|complex>
tool: mcp__sequential-thinking__sequentialthinking
total_thoughts: <最终使用的思考步数>
created_at: <ISO8601 时间戳或 date 输出>
---

# Plan: <任务简要标题>

🎯 任务概述
<用 2–3 句话说明任务背景和目标。>

📋 执行计划
1. <步骤 1：一句话描述要做什么、为什么>
2. <步骤 2>
3. <步骤 3>
...（根据 sequential-thinking 的结果展开，一般 4–10 步）

⚠️ 风险与注意事项
- <风险或注意点 1>
- <风险或注意点 2>

📎 参考
- `<文件路径:行号>`（例如 `src/main/java/App.java:42`）
- 其他有用的链接或说明
```

要求：
- 元数据头部必须位于文件开头，且使用上述 `---` 包裹的 YAML 形式，与正文明显分隔；
- 字段名保持小写短横线分隔风格（如 `total_thoughts`），便于脚本解析；
- 如果某些字段暂时无法确定（例如 complexity），可以先用你当前的最佳判断，不要留空字段名。

3. 写入方式与失败处理

- 使用当前平台的 shell 在工作目录下执行命令创建 `plan/` 目录并写入文件，注意避免使用仅适用于单一平台的命令：
  - 在类 Unix 环境中，可以使用：`mkdir -p plan`；
  - 在 Windows PowerShell 中，可以使用：`New-Item -ItemType Directory -Force -Path plan`；
  - 然后使用适合当前 shell 的方式（重定向、heredoc、`Set-Content` / `Out-File` 等）将 Markdown 内容写入新文件。
- 写入成功后，在对话中明确告知用户：
  - 实际文件路径；
  - 是否包含 PLAN_META 区块与完整计划内容。
- 如果因审批/策略限制或其他错误无法创建/写入文件：
  - 在回答中说明原因；
  - 仍然输出完整的计划文本，保证用户可以手动复制到文件中。

## 五、在同一会话中多次触发 Plan 模式时的识别与配合

在一个 Codex 会话中，用户可能多次触发 Plan 模式，例如：

- 第一次：`/prompts:plan 帮我设计 XXX 的实现方案`
- 第二次：`/prompts:plan 前面设计得不太合理，我想进行调整`（或用户通过快捷键再次触发同一 prompt）

你需要根据用户意图判断是「继续同一个 Plan」还是「创建新的 Plan」，并据此选择读取或新建 Plan 文件。

1. 同一 Plan 的识别规则（默认优先认为是「同一 Plan」）
   - 若这是本会话中第一次进入 Plan 模式：创建新的 Plan 文件。
   - 若本会话中已经存在一个当前 Plan（你在之前回答中已经输出过 `Plan 文件：路径：plan/....md`）：
     - 当用户使用类似「前面」「刚才」「之前的计划」「上一个方案」「在原来的基础上调整」等表述时，视为继续同一个 Plan：
       - 不创建新文件；
       - 使用之前记录的 Plan 文件路径作为「当前 Plan」；
       - 通过 `cat plan/XXXX.md` 先读取原始计划，基于此进行修改或增量更新。
     - 当用户明确表述「新的 Plan」「另一个任务」「换一个需求」「重新为 YYY 设计一个方案」时，视为新 Plan：
       - 为新任务创建新的 Plan 文件；
       - 在回答中明确区分旧 Plan 与新 Plan 的文件路径。
   - 如果用户话语模糊，无法判断是继续还是新建：
     - 先用一句话进行澄清询问（例如：「这是在调整上一个 Plan，还是要为一个全新的任务创建新的 Plan？」），再按用户选择执行。

2. 继续同一 Plan 时的行为
   - 优先通过 shell 读取当前 Plan 文件内容（例如 `cat plan/2025-12-01_17-05-30-plan.md`），快速回顾已有计划的摘要；
   - 如果用户希望调整计划：
     - 在回答中先给出「变更摘要」，说明相对于原 Plan 的主要修改点；
     - 再给出更新后的完整计划片段（可以是替换某几个 Phase，也可以新增 Phase）；
     - 使用追加或重写的方式更新同一个 Plan 文件，并在回答中说明：
       - 已更新的 Plan 文件路径；
       - 如果在文件中使用了「变更记录」或「修订版」小节，简单说明你的结构。

3. 创建新 Plan 时的行为
   - 按「四、Plan 文件落地规范」中新建 Plan 文件；
   - 在回答中明确标注这是一个新的 Plan，并给出新文件路径；
   - 如有必要，在新 Plan 文件的开头备注「与旧 Plan 的关系」（例如是重写、分支方案等）。

始终保持计划简单、明确、可执行，避免为了炫技而过度设计，遵守 KISS / YAGNI 原则。