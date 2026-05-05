# TG·Push

Telegram 消息转发推送工具。监听 Telegram 私聊/群聊/频道消息，按关键词过滤后推送到目标服务。

## 功能特性

- 🔌 **MTProto 登录** — 使用 API ID/HASH 登录 Telegram 账号（非 Bot Token）
- 🌐 **SOCKS5 代理** — 支持代理连接 Telegram API
- 🎧 **多源监听** — 同时监听私聊、群聊、频道、Bot 消息
- 🔍 **智能过滤** — 关键词包含/排除、正则匹配、消息类型过滤
- 🚀 **消息推送** — 过滤后的消息自动推送到目标推送服务
- 📊 **实时日志** — SSE 实时推送消息流到 Web UI
- 💾 **Session 持久化** — 重启免重新登录
- 🔄 **自动重连** — 网络中断后自动恢复连接

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

**Mac/Linux：**
```bash
chmod +x start.sh && ./start.sh
```

**Windows：**
```
双击 start.bat 或在命令行执行 start.bat
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

## 项目结构

```
tg-magicpush/
├── public/              ← 前端界面
│   ├── index.html       ← 主页面
│   ├── style.css        ← 样式（现代毛玻璃设计）
│   └── app.js           ← 前端逻辑 + SVG 图标系统
├── src/                 ← 后端代码
│   ├── server.js        ← Express 服务入口
│   ├── telegram-client.js ← gramjs TG 客户端封装
│   ├── forwarder.js     ← 统一转发引擎（支持 Magic Push/Webhook/Custom API）
│   └── config.js        ← 配置管理模块
├── data/                ← 运行时数据
│   ├── config.json      ← 用户配置
│   └── session.txt      ← Telegram Session（自动生成）
├── package.json         ← 依赖声明
├── start.sh             ← Mac/Linux 启动脚本
├── start.bat            ← Windows 启动脚本
└── README.md            ← 本文件
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 18+ |
| Telegram 客户端 | gramjs (telegram npm 包) |
| HTTP 服务 | Express |
| 前后端通信 | REST API + SSE |
| 代理协议 | SOCKS5 |

## API 文档

所有接口均返回 JSON 格式：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 连接状态 |
| POST | `/api/connect` | 发起连接 |
| POST | `/api/send-code` | 发送验证码 |
| POST | `/api/sign-in` | 提交验证码/2FA密码 |
| POST | `/api/disconnect` | 断开连接 |
| GET | `/api/check-reachability` | 检测 API 可达性 |
| GET | `/api/dialogs` | 获取聊天列表 |
| GET | `/api/config` | 读取配置 |
| PUT | `/api/config` | 更新配置 |
| GET | `/api/listeners` | 监听源列表 |
| POST | `/api/listeners` | 添加监听源 |
| DELETE | `/api/listeners/:id` | 删除监听源 |
| GET | `/api/filters` | 过滤规则 |
| PUT | `/api/filters` | 更新过滤规则 |
| POST | `/api/forward/test` | 测试推送 |
| GET | `/api/forward/stats` | 转发统计 |
| GET | `/api/messages/stream` | SSE 消息流 |
| GET | `/api/messages/history` | 历史消息 |

## 注意事项

1. **API ID/HASH 安全**：从 my.telegram.org 获取的凭证不要泄露给他人
2. **Session 安全**：session.txt 包含登录凭证，请勿分享
3. **代理要求**：中国大陆用户需要配置 SOCKS5 代理才能连接 Telegram
4. **推送服务**：需要先部署 [Magic Push](https://github.com/magiccode1412/magicpush) 服务（或其他兼容的推送接收端）
5. **频率限制**：推送服务可能有发送频率限制，默认每秒最多 2 条

## License

MIT
