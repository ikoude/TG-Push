# 项目结构优化说明

## 变更日期
2026-05-05

## 优化目标
- 提升代码可维护性、可扩展性和开发效率
- 按照功能模块对代码文件进行合理组织与分类
- 明确划分公共组件、工具函数、业务逻辑和配置文件的存放路径
- 建立清晰的模块间依赖关系，避免循环依赖
- 制定并遵循一致的命名规范和文件组织结构标准

## 新目录结构

```
tg-magicpush/
├── src/
│   ├── server.js              # Express 服务主入口 (精简后 ~350 行)
│   ├── config.js               # 配置管理器 (原文件保留)
│   ├── constants.js            # 全局常量定义
│   │
│   ├── config/                # 配置模块
│   │   └── index.js            # 配置导出 (兼容层)
│   │
│   ├── services/               # 核心业务逻辑
│   │   ├── index.js            # 服务导出
│   │   ├── telegram-client.js  # Telegram 客户端封装 (重构自根目录)
│   │   ├── forwarder.js        # 消息转发引擎 (重构自根目录)
│   │   └── init-manager.js      # 初始化管理 (重构自根目录)
│   │
│   ├── routes/                 # API 路由层
│   │   ├── index.js            # 路由注册与组合
│   │   ├── accounts.js         # 账户管理 API
│   │   ├── connection.js        # 连接操作 API
│   │   ├── listeners.js         # 监听源 API
│   │   ├── filters.js           # 过滤规则 API
│   │   ├── forward-servers.js   # 转发服务器 API
│   │   ├── forward.js           # 转发测试与统计 API
│   │   ├── webhooks.js          # Webhook API
│   │   ├── status.js            # 状态与配置 API
│   │   ├── logs.js              # 日志 API
│   │   ├── init.js              # 初始化管理 API
│   │   └── sse.js               # SSE 流式 API
│   │
│   ├── middleware/             # Express 中间件
│   │   ├── index.js            # 中间件导出
│   │   ├── error-handler.js    # 错误处理中间件
│   │   └── cors.js             # CORS 中间件
│   │
│   ├── state/                  # 全局状态管理
│   │   └── index.js            # 应用状态与事件
│   │
│   └── utils/                  # 工具函数 (已存在)
│       ├── index.js
│       ├── logger.js
│       ├── helpers.js
│       ├── error-handler.js
│       └── express-error-handler.js
│
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js                  # 前端主文件
│   ├── init-functions.js       # 初始化功能
│   ├── api/                    # 前端 API 客户端
│   │   └── index.js
│   ├── components/            # 前端组件 (预留)
│   └── modules/                # 前端模块
│       └── accountManager.js    # 账户管理模块
│
├── data/                       # 运行时数据
│   ├── config.json
│   ├── sessions/
│   └── *.json
│
├── docs/                       # 文档
│
├── package.json
└── README.md
```

## 优化详情

### 1. 后端模块化重构

#### 路由层 (routes/)
将原来集中在 `server.js` 中的所有 API 路由拆分为独立文件：
- **accounts.js** - 账户 CRUD 操作
- **connection.js** - 连接、认证、验证码流程
- **listeners.js** - 监听源管理
- **filters.js** - 过滤规则配置
- **forward-servers.js** - 转发服务器管理
- **forward.js** - 转发测试与统计
- **webhooks.js** - Webhook 管理与入站消息处理
- **status.js** - 系统状态与配置
- **logs.js** - 日志查询与导出
- **init.js** - 系统初始化操作
- **sse.js** - Server-Sent Events

#### 服务层 (services/)
核心业务逻辑独立封装：
- **telegram-client.js** - Telegram MTProto 客户端封装
- **forwarder.js** - 统一转发引擎（支持 magicpush/webhook/custom 三种模式）
- **init-manager.js** - 系统初始化与数据清理

#### 状态层 (state/)
新增全局状态管理模块：
- 统一的客户端实例管理 (`tgClients`)
- 转发器实例管理 (`forwarders`)
- SSE 连接管理 (`sseClients`)
- 消息历史与操作日志
- 状态变更广播

#### 中间件层 (middleware/)
- **error-handler.js** - 统一错误处理与格式化
- **cors.js** - 可配置的跨域资源共享

### 2. 依赖关系

```
server.js
├── services/telegram-client.js
├── services/forwarder.js
├── services/init-manager.js
├── config (config.js)
├── state/index.js
├── routes/index.js
│   ├── routes/accounts.js
│   ├── routes/connection.js
│   ├── routes/listeners.js
│   ├── routes/filters.js
│   ├── routes/forward-servers.js
│   ├── routes/forward.js
│   ├── routes/webhooks.js
│   ├── routes/status.js
│   ├── routes/logs.js
│   ├── routes/init.js
│   └── routes/sse.js
└── middleware/
    ├── error-handler.js
    └── cors.js
```

### 3. 文件清理

删除的冗余文件：
- `src/telegram-client.js` → 已迁移至 `src/services/telegram-client.js`
- `src/forwarder.js` → 已迁移至 `src/services/forwarder.js`
- `src/init-manager.js` → 已迁移至 `src/services/init-manager.js`

保留的文件：
- `src/config.js` - 配置管理器核心实现
- `src/utils/*` - 工具函数库（未被充分利用，但保持完整）

### 4. 主要改进

1. **单一职责原则** - 每个文件专注于单一功能
2. **易于导航** - 根据文件名即可定位功能
3. **并行开发** - 不同路由可以由不同开发者同时处理
4. **易于测试** - 独立模块便于单元测试
5. **减少冲突** - Git 合并冲突减少

### 5. API 路由保持不变

所有现有 API 端点保持兼容：
- `/api/accounts` - 账户管理
- `/api/connect`, `/api/send-code`, `/api/sign-in` - 认证流程
- `/api/listeners` - 监听源
- `/api/filters` - 过滤规则
- `/api/forward-servers` - 转发服务器
- `/api/webhook` - Webhook
- `/api/status`, `/api/config` - 状态与配置
- `/api/logs`, `/api/messages/history` - 日志
- `/api/init/*` - 初始化
- `/api/events`, `/api/messages/stream` - SSE

## 验证结果

- [x] 所有 JavaScript 文件语法检查通过
- [x] 服务启动成功
- [x] API `/api/accounts` 返回正确数据
- [x] API `/api/status` 返回正确数据
- [x] API `/api/forward-servers` 返回正确数据
- [x] Telegram 客户端自动重连成功
- [x] 消息监听功能正常

## 后续优化建议

1. **前端拆分** - `public/app.js` (187KB) 可以进一步拆分为：
   - 状态管理模块
   - UI 组件模块
   - 业务逻辑模块

2. **工具函数利用** - `src/utils/` 下的模块目前未被主代码充分利用，可以逐步集成

3. **类型定义** - 考虑迁移到 TypeScript 以获得更好的类型安全

4. **测试覆盖** - 为核心模块添加单元测试

5. **文档完善** - 为各模块添加 JSDoc 注释