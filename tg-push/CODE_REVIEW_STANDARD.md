# TG·Push 代码审查标准与流程 v1.0

> 基于项目当前代码现状（2026-05-01）制定，随项目演进持续更新。

---

## 一、项目现状诊断

### 1.1 代码规模

| 文件 | 行数 | 职责 |
|------|------|------|
| `public/app.js` | **2537** | 前端核心逻辑（124个函数） |
| `public/style.css` | **2034** | 全部样式（含重复定义） |
| `public/index.html` | 579 | 页面结构 |
| `src/server.js` | **1121** | Express API + SSE（41条路由） |
| `src/telegram-client.js` | 759 | Telegram 客户端封装 |
| `src/config.js` | 502 | 配置管理 |
| `src/forwarder.js` | 308 | 转发引擎 |
| `src/magic-push.js` | 197 | Magic Push 适配器 |
| **合计** | **8037** | |

### 1.2 已识别问题清单（按优先级）

| 级别 | 问题 | 位置 | 影响 |
|------|------|------|------|
| **P0** | XSS 风险：49处 innerHTML 拼接，部分可能未转义 | app.js 全局 | 安全漏洞 |
| **P0** | 无 API 认证/鉴权机制 | server.js:27-33 CORS全开 | 任何人可操作API |
| **P1** | CSS 重复定义：`.dialog-item` 定义了两遍（1412行 vs 1981行） | style.css | 样式冲突隐患 |
| **P1** | 函数过长风险：showAddListener、renderWizardListeners 等可能超80行 | app.js 多处 | 可读性差、难测试 |
| **P1** | 错误处理不一致：18个 try-catch 覆盖124个函数（仅15%） | app.js | 异常静默丢失 |
| **P1** | 无统一错误处理中间件：每个路由单独 try-catch | server.js | 代码冗余 + 遗漏风险 |
| **P2** | 无 ESLint/Prettier 配置 | 项目根目录 | 代码风格无法自动保障 |
| **P2** | 全局状态对象 AppState 过于庞大（15个顶层属性） | app.js:6-39 | 状态管理混乱 |
| **P2** | DOM 操作全部用 innerHTML 字符串拼接 | app.js 渲染函数 | 性能差、难维护 |
| **P2** | var/let/const 使用混用（如 addManualListener 用 var） | app.js:654+ | 风格不统一 |
| **P3** | 注释覆盖率低，缺少 JSDoc | 大部分文件 | 可理解性差 |
| **P3** | Magic Number 散布（如 MAX_HISTORY=500, maxLength=4096） | 多处 | 语义不明确 |

---

## 二、审查标准（Checklist）

### 2.1 安全性审查（P0 — 一票否决）

```markdown
## Security Checklist
- [ ] 所有用户输入经过 escHtml() / escAttr() 转义后才能拼入 innerHTML
- [ ] 不允许直接将 API 返回数据或用户输入插入 DOM（必须转义）
- [ ] 敏感字段（apiHash、proxy password、token）不得在前端明文展示或日志输出
- [ ] API 路由需做参数校验（类型、范围、格式），不能信任前端传入值
- [ ] CORS 策略按环境区分（开发 *，生产限定域名）
- [ ] session 文件和配置文件不含在 .gitignore 中但被提交的密钥
```

**当前项目违规示例：**
```javascript
// ⚠️ 危险：如果 d.name 含 <script> 标签则存在XSS风险
html += '<div class="dialog-name">' + escHtml(d.name) + '</div>';  // ✅ 已用escHtml

// 但某些地方可能遗漏：
html += '<span>' + someRawValue + '</span>';  // ❌ 如果 someRawValue 未转义
```

### 2.2 正确性审查（P1 — 必须通过）

```markdown
## Correctness Checklist
- [ ] 新增函数有明确的单一职责，长度不超过 80 行
- [ ] 所有异步操作（async/await、Promise）都有错误处理（try/catch 或 .catch）
- [ ] API 调用失败时有用户可见的错误提示（toast / 内联提示）
- [ ] 边界情况已处理：空数组、null/undefined、空字符串、网络超时
- [ ] DOM 元素操作前做了 null 检查（if (el) ...）
- [ ] 事件绑定的回调函数引用有效（不存在 undefined function）
- [ ] 变量声明使用 const 优先，let 次之，禁止 var（新代码）
```

**当前项目改进方向：**
- server.js 的41条路由每条都重复 try-catch → 应提取为统一错误处理中间件
- app.js 仅 18 个 try-catch 覆盖 124 个函数 → 需补齐关键路径的错误处理

### 2.3 可维护性审查（P2 — 强烈建议）

```markdown
## Maintainability Checklist
- [ ] 函数命名清晰，动词开头，语义明确（如 renderDialogs 而非 doDialog）
- [ ] 避免深层嵌套（>3层），使用 early return 模式
- [ ] 不出现重复代码超过3次（应抽取为公共函数）
- [ ] CSS 类名不重复定义（检查 style.css 是否有同名规则）
- [ ] Magic Number 提取为命名常量（文件顶部或 config 对象）
- [ ] HTML 模板字符串中避免嵌套超过 3 层三元表达式
- [ ] Modal 创建前先清理旧实例（remove 旧元素再 append）
```

### 2.4 代码规范（P3 — 逐步改善）

```markdown
## Code Style Checklist
- [ ] 文件头部有简明的模块说明注释（用途、版本、依赖关系）
- [ ] 公共函数有 JSDoc 注释（@param @returns @example）
- [ ] 复杂逻辑有行内注释解释"为什么"而非"是什么"
- [ ] 缩进一致（2空格 or 4空格，统一选择一种）
- [ ] 字符串统一用单引号或双引号（不要混用）
- [ ] 尾逗号风格一致（对象/数组最后一项是否加逗号）
- [ ] console.log 调试代码不应出现在提交中
```

---

## 三、审查流程

### 3.1 五阶段流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  编码自检 │ → │  提交PR  │ → │  审查评审 │ → │  修复迭代 │ → │  合并发布 │
│          │    │          │    │          │    │          │    │          │
│ • Lint   │    │ • PR描述 │    │ • 自动化  │    │ • 讨论   │    │ • Squash │
│ • 自测   │    │ • Checklist│   │ • 人工Review│  • 修改   │    │ • Main   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
     ~10min        ~5min         ~30min         循环直到通过      ~2min
```

#### 阶段一：编码自检（开发者本人）

1. **语法检查**：`node --check` 对修改的 JS 文件执行
2. **功能自测**：手动走一遍涉及的功能路径
3. **安全自查**：对照 Security Checklist 逐项确认
4. **边界测试**：空值、异常输入、网络断开等场景

#### 阶段二：提交 PR

PR 描述模板：
```markdown
## 变更概述
[一句话描述做了什么]

## 变更类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构
- [ ] 样式/UI调整

## 影响范围
[列出修改的文件]

## 测试步骤
[ reviewer 可以复现的步骤 ]

## 审查重点
[ 希望 reviewer 重点关注的区域 ]
```

#### 阶段三：审查评审

**自动化检查项（理想情况下）：**
- `node --check` 通过
- 无 console.log 残留
- 文件大小变化合理（单文件改动不超过 ±200 行为佳）

**人工 Review 要点：**
1. 先看 PR 描述，理解变更意图
2. 逐文件 diff 阅读，关注变更行而非整个文件
3. 按 P0→P1→P2→P3 顺序审查
4. 发现问题时标注级别（P0/P1/P2/P3）并给出建议

**Review 评论模板：**
```markdown
## 审查结论：[ 通过 / 有条件通过 / 需要修改 ]

### 问题列表
| # | 级别 | 文件:行 | 问题描述 | 建议 |
|---|------|---------|---------|------|
| 1 | P1    | app.js:1057 | splice参数间有空格导致运行时错误 | 改为 splice(idx, 1) |

### 其他观察
- （可选：架构建议、性能提示、正面评价）
```

#### 阶段四：修复迭代

- P0 问题：**阻断合并**，必须立即修复
- P1 问题：**强烈建议修复**后再合并，特殊情况可开追踪 issue 延后
- P2/P3 问题：可以创建 issue 追踪，不阻塞合并

#### 阶段五：合并发布

- 使用 Squash merge 保持历史整洁
- 合并消息格式：`feat/fix/refactor: 简短描述 (#PR编号)`
- 合并后通知相关方（如有 CI/CD 则自动触发）

### 3.2 审查角色与职责

| 角色 | 职责 | 要求 |
|------|------|------|
| **作者** | 编码、自测、写 PR 描述、响应 review | 熟悉变更内容 |
| **Reviewer** | 检查代码质量、标注问题、给出建议 | 熟悉项目架构即可 |
| **Approver**（可选） | 最终合并决策 | 项目负责人 |

---

## 四、针对 TG·Push 的特殊规范

### 4.1 前端（app.js / style.css / index.html）

| 规范 | 说明 |
|------|------|
| DOM 操作 | 新代码优先用 createElement + classList，避免大段 innerHTML 拼接 |
| HTML 模板 | 如必须拼接，所有动态值必须经过 escHtml()/escAttr() |
| 状态读写 | 通过 AppState 统一管理，禁止散落的全局变量 |
| Modal 管理 | 创建前先 remove 同 id 的旧实例，防止堆叠 |
| 事件绑定 | 优先事件委托，减少 onclick 属性中的引号嵌套 |
| CSS | 新增样式先 grep 确认无同名规则再添加 |

### 4.2 后端（server.js / *.js）

| 规范 | 说明 |
|------|------|
| 路由组织 | 按资源分组，加注释分隔（如 `// ====== 账户 API ======`） |
| 错误响应 | 统一格式 `{ success: false, error: '具体信息' }` |
| 参数校验 | 路由体内第一件事就是校验 req.body / req.params |
| 日志格式 | `[模块] 动作: 详情`（如 `[API] POST /api/accounts: 创建成功`） |
| async 路由 | 必须有 try-catch包裹，catch 中返回 500 + 错误信息 |

### 4.3 配置文件（config.json / config.js）

| 规范 | 说明 |
|------|------|
| 敏感字段 | apiHash、password 等在日志/API返回中脱敏显示为 `******` |
| 默认值 | 所有新增配置项必须有合理的默认值 |
| 向后兼容 | config.js 加载时自动迁移旧版配置格式 |
| 类型校验 | 关键字段做类型和范围校验 |

---

## 五、审查工具建议

### 当前可立即使用的（零成本）

| 工具 | 用法 | 适用场景 |
|------|------|---------|
| `node --check file.js` | 语法检查 | 每次修改后必做 |
| `grep -n 'innerHTML.*+' app.js` | 检查未转义的DOM插入 | 安全审查 |
| `wc -l file.js` | 监控文件膨胀 | 单文件超过500行考虑拆分 |
| `grep -c 'try {' file.js` | 检查错误处理覆盖 | 质量评估 |

### 建议引入的（低成本高收益）

| 工具 | 配置难度 | 收益 |
|------|---------|------|
| **ESLint** + 定制规则 | 低（~30分钟配置） | 自动捕获 60%+ 的代码风格问题和常见 bug |
| **Prettier** | 极低（~10分钟） | 自动统一格式化，消除风格争论 |
| **package.json scripts** | 低 | 加入 lint/check/test 命令，固化流程 |

### 推荐的 ESLint 核心规则（针对本项目）

```javascript
// .eslintrc.json (建议配置)
{
  "env": { "browser": true, "node": true, "es2020": true },
  "rules": {
    // 安全
    "no-eval": "error",
    "no-implied-eval": "error",

    // 代码质量
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "no-undef": "error",
    "eqeqeq": ["warn", "always"],
    "curly": ["error", "all"],

    // 风格
    "quotes": ["warn", "single", { "avoidEscape": true }],
    "semi": ["error", "always"],
    "no-var": "error",              // 新代码禁用var
    "prefer-const": "warn",
    "no-trailing-spaces": "warn",
    "comma-dangle": ["warn", "always-multiline"],

    // 复杂度
    "complexity": ["warn", 15],
    "max-lines-per-function": ["warn", 80],
    "max-depth": ["warn", 4],
    "max-params": ["warn", 5]
  }
}
```

---

## 六、执行计划

### Phase 1：立即可做（本周）

1. ✅ 制定本审查标准文档 ← **已完成**
2. 🔲 将每次 `node --check` 固化为编码习惯
3. 🔲 每次修改前先 grep 确认 CSS 无重复规则

### Phase 2：短期改进（本月）

4. 🔲 引入 ESLint + Prettier（最小配置即可）
5. 🔲 修复已识别的 P0/P1 问题（见 1.2 节）
6. 🔲 server.js 提取统一错误处理中间件

### Phase 3：中期优化（下月）

7. 🔲 app.js 超长函数拆分（目标：所有函数 ≤ 80 行）
8. 🔲 CSS 重复定义清理
9. 🔲 建立 git hook（pre-commit 时自动 lint）

---

*文档版本：v1.0 | 创建日期：2026-05-01 | 最后更新：2026-05-01*
