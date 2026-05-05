# TG·Push（屎山·AI版）

> 该项目仅为思路，欢迎各位大佬重构或修改。

Telegram 消息转发推送工具。监听私聊/群聊/频道消息，按关键词过滤后推送到目标服务。


![TG·Push](https://img.shields.io/badge/version-v3.1-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-orange)

---
## 预览

![主界面](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-42-12-978Z.png?raw=true)
![主界面](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-43-12-006Z.png?raw=true)
![账户管理](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-43-38-405Z.png?raw=true)
![主界面](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-44-36-399Z.png?raw=true)
![webhook](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-45-12-059Z.png?raw=true)
![路由管理](https://github.com/ikoude/TG-PUSH/blob/main/screenshots/page-2026-05-05T16-45-58-403Z.png?raw=true)

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [故障排除](#故障排除)
- [贡献指南](#贡献指南)
- [更新日志](#更新日志)
- [许可证](#许可证)

---

## 功能特性

- **MTProto 登录** — 使用 API ID/HASH 登录 Telegram 账号（非 Bot Token）
- **SOCKS5/HTTP 代理** — 支持 SOCKS5 和 HTTP 代理连接 Telegram API
- **多源监听** — 同时监听私聊、群聊、频道、Bot 消息
- **智能过滤** — 关键词包含/排除、正则匹配、消息类型过滤
- **多方式推送** — 支持 Webhook、自定义 API 推送
- **实时日志** — SSE 实时推送消息流到 Web UI
- **Session 持久化** — 重启免重新登录
- **自动重连** — 网络中断后自动恢复连接
- **环境区分** — 支持开发/生产环境日志级别控制

---

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm 或 yarn

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

**开发模式（显示完整日志）：**
```bash
npm start
```

**生产模式（仅显示 WARN 和 ERROR）：**
```bash
npm run start:prod
```

**Mac/Linux：**
```bash
chmod +x start.sh && ./start.sh
```

**Windows：**
```cmd
start.bat
```

### 3. 打开浏览器

访问 http://localhost:3210

### 4. 配置并连接

1. 在「连接管理」页面填写：
   - **API ID** 和 **API Hash**（从 https://my.telegram.org 申请）
   - **代理地址**（如需翻墙访问 TG）
2. 点击「检测可达性」确认网络通畅
3. 点击「连接」→ 输入手机号 → 输入验证码 → 完成
4. 在「监听源」添加要监控的聊天
5. 在「过滤规则」配置关键词
6. 在「转发配置」填写推送服务的 URL 和 Token
7. 点击「测试推送」验证配置

---

## 项目结构

```
tg-push/
├── src/                      # 后端源代码
│   ├── server.js            # Express 服务入口
│   ├── config.js            # 配置管理模块
│   ├── constants.js         # 全局常量定义
│   ├── config/              # 配置子模块
│   │   └── index.js
│   ├── services/            # 核心业务逻辑
│   │   ├── telegram-client.js  # Telegram 客户端封装
│   │   ├── forwarder.js        # 统一转发引擎
│   │   └── init-manager.js     # 初始化管理
│   ├── routes/              # API 路由层
│   │   ├── accounts.js        # 账户管理
│   │   ├── connection.js      # 连接认证
│   │   ├── listeners.js       # 监听源管理
│   │   ├── filters.js         # 过滤规则
│   │   ├── forward-servers.js # 转发服务器
│   │   ├── webhooks.js        # Webhook 管理
│   │   ├── forward.js          # 转发测试
│   │   ├── status.js          # 状态查询
│   │   ├── logs.js            # 日志查询
│   │   ├── sse.js             # SSE 流
│   │   └── init.js            # 初始化接口
│   ├── middleware/          # Express 中间件
│   │   ├── cors.js            # CORS 配置
│   │   └── error-handler.js   # 错误处理
│   ├── state/               # 全局状态管理
│   │   └── index.js
│   └── utils/               # 工具函数
│       ├── logger.js          # 日志管理器
│       ├── helpers.js         # 辅助函数
│       └── error-handler.js   # 错误处理工具
├── public/                  # 前端静态资源
│   ├── index.html          # 主页面
│   ├── style.css           # 样式文件
│   └── app.js              # 前端逻辑
├── data/                    # 运行时数据
│   ├── config.json         # 用户配置（自动生成）
│   ├── config.json.default  # 默认配置模板
│   └── sessions/           # Telegram Session 文件
├── screenshots/            # 功能截图
├── package.json            # 依赖声明
├── package-lock.json       # 锁定依赖版本
├── start.sh               # Mac/Linux 启动脚本
├── start.bat              # Windows 启动脚本
├── .eslintrc.json         # ESLint 配置
├── .prettierrc.json       # Prettier 配置
└── README.md              # 本文件
```

---

## 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js | >= 18.0.0 |
| Telegram 客户端 | gramjs (telegram) | ^2.17.4 |
| HTTP 服务 | Express | ^4.21.0 |
| 前后端通信 | REST API + SSE | - |
| 代理协议 | SOCKS5 / HTTP | - |

---

## 配置说明

### 配置文件

配置文件位于 `data/config.json`，首次运行后自动生成。

**配置结构：**
```json
{
  "env": "development",
  "port": 3210,
  "accounts": [
    {
      "id": "acc_xxx",
      "name": "主号",
      "apiId": 1234567,
      "apiHash": "xxxxxxxxxxxx",
      "proxy": {
        "type": "socks5",
        "address": "192.168.1.1",
        "port": 7890,
        "username": "",
        "password": ""
      },
      "listeners": [],
      "filters": {
        "ignoreForwarded": false,
        "ignoreReply": false,
        "includeKeywords": [],
        "excludeKeywords": []
      }
    }
  ],
  "forwardServers": [
    {
      "id": "srv_xxx",
      "name": "推送服务",
      "type": "webhook",
      "url": "http://localhost:3000/api/webhook/xxx",
      "token": "your-token"
    }
  ]
}
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 服务端口 | `3210` |

**运行模式：**
- `NODE_ENV=development` — 开发模式，显示所有日志
- `NODE_ENV=production` — 生产模式，仅显示 WARN 和 ERROR

---

## API 文档

所有接口均返回 JSON 格式，默认前缀 `/api`。

### 认证连接

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 获取连接状态 |
| POST | `/api/connect` | 发起连接 |
| POST | `/api/send-code` | 发送验证码 |
| POST | `/api/sign-in` | 提交验证码/2FA密码 |
| POST | `/api/disconnect` | 断开连接 |
| GET | `/api/check-reachability` | 检测 API 可达性 |

### 账户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 获取账户列表 |
| POST | `/api/accounts` | 添加账户 |
| PUT | `/api/accounts/:id` | 更新账户 |
| DELETE | `/api/accounts/:id` | 删除账户 |

### 监听源

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/listeners` | 获取监听源列表 |
| POST | `/api/listeners` | 添加监听源 |
| DELETE | `/api/listeners/:id` | 删除监听源 |

### 过滤规则

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/filters` | 获取过滤规则 |
| PUT | `/api/filters` | 更新过滤规则 |

### 转发服务器

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/forward-servers` | 获取服务器列表 |
| POST | `/api/forward-servers` | 添加服务器 |
| PUT | `/api/forward-servers/:id` | 更新服务器 |
| DELETE | `/api/forward-servers/:id` | 删除服务器 |

### Webhook

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/webhooks` | 获取 Webhook 列表 |
| POST | `/api/webhooks` | 创建 Webhook |
| DELETE | `/api/webhooks/:id` | 删除 Webhook |
| POST | `/api/webhooks/:id/test` | 测试 Webhook |

### 消息与日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/messages/stream` | SSE 消息流 |
| GET | `/api/messages/history` | 历史消息 |
| GET | `/api/logs` | 综合日志 |
| DELETE | `/api/logs/history` | 清除消息历史 |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 读取配置 |
| PUT | `/api/config` | 更新配置 |
| POST | `/api/init/full` | 完整初始化 |
| POST | `/api/forward/test` | 测试推送 |
| GET | `/api/forward/stats` | 转发统计 |

---

## 故障排除

### 常见问题

#### 1. 连接 Telegram 失败

**症状：** 无法连接到 Telegram，提示连接超时。

**解决方案：**
- 检查是否需要配置代理（大陆用户必须配置 SOCKS5 代理）
- 确认 API ID 和 API Hash 正确
- 检查网络连接是否正常

#### 2. 验证码发送失败

**症状：** 点击发送验证码后无响应或提示错误。

**解决方案：**
- 确认手机号格式正确（包含国家代码，如 +86）
- 检查是否能在其他客户端接收验证码
- 尝试重启服务后重试

#### 3. 消息未转发

**症状：** 收到消息但未推送到目标服务。

**解决方案：**
- 检查监听源是否正确配置
- 检查过滤规则是否正确
- 确认转发服务器 URL 和 Token 正确
- 查看日志中的转发记录

#### 4. 生产环境日志过多

**症状：** 在生产环境中看到大量调试日志。

**解决方案：**
```bash
# 使用生产模式启动
npm run start:prod
```

#### 5. Session 失效

**症状：** 重启后需要重新登录。

**解决方案：**
- 检查 `data/sessions/` 目录是否存在
- 确认 session 文件未被删除或损坏

### 日志级别

| 级别 | 值 | 开发环境 | 生产环境 |
|------|-----|----------|----------|
| DEBUG | 0 | ✅ 输出 | ❌ 过滤 |
| INFO | 1 | ✅ 输出 | ❌ 过滤 |
| WARN | 2 | ✅ 输出 | ✅ 输出 |
| ERROR | 3 | ✅ 输出 | ✅ 输出 |

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发设置

```bash
# 克隆项目
git clone <repository-url>
cd tg-push

# 安装依赖
npm install

# 启动开发模式（支持热重载）
npm run dev

# 代码检查
npm run check:all
```

### 代码规范

- 使用 ESLint 进行代码检查
- 使用 Prettier 格式化代码
- 提交前确保通过所有检查

---

## 更新日志

### v3.1 (当前版本)

- ✨ 项目结构模块化重构
- ✨ 支持生产/开发环境日志级别区分
- ✨ 新增 Webhook 管理功能
- ✨ 优化错误处理机制
- 🔧 修复多项稳定性问题

### v3.0

- ✨ 全新 UI 设计
- ✨ SSE 实时消息流
- ✨ 多账户支持

### v2.x

- ✨ 基础转发功能
- ✨ 过滤规则支持

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
