# 系统初始化功能模块文档

## 概述

本模块提供系统初始化相关功能，允许管理员清除用户数据、日志及配置，将系统恢复至初始状态。

## 功能说明

### 1. 账户数据清除

**功能描述**：删除所有已连接的 Telegram 账户及其会话信息

**API 接口**：`POST /api/init/clear-accounts`

**执行流程**：
1. 断开所有活跃的 Telegram 连接
2. 清除内存中的账户列表
3. 删除 `data/sessions/` 目录中的所有会话文件
4. 删除 `data/session.txt` 文件

**返回结果**：
```json
{
  "success": true,
  "deletedFiles": ["sessions/ (2 files)", "session.txt"],
  "errors": []
}
```

---

### 2. 日志清除

**功能描述**：清除消息日志和操作日志

**API 接口**：`POST /api/init/clear-logs`

**执行流程**：
1. 清除内存中的消息历史和操作日志
2. 删除 `data/message-history.json` 文件
3. 删除 `data/operation-log.json` 文件

**返回结果**：
```json
{
  "success": true,
  "deletedFiles": ["message-history.json", "operation-log.json"],
  "errors": []
}
```

---

### 3. 配置还原

**功能描述**：将所有用户自定义设置恢复至系统默认状态

**API 接口**：`POST /api/init/restore-config`

**执行流程**：
1. 生成默认配置文件内容
2. 覆盖 `data/config.json` 文件
3. 重新加载配置到内存

**默认配置**：
```json
{
  "version": "1.0.0",
  "telegram": {
    "apiId": null,
    "apiHash": null,
    "phone": null
  },
  "forward": {
    "autoStart": false,
    "retryCount": 3,
    "retryDelay": 5000
  },
  "webhook": {
    "enabled": false,
    "port": 8080,
    "path": "/webhook"
  },
  "logging": {
    "level": "info",
    "maxHistory": 500,
    "maxOpLogs": 1000
  },
  "ui": {
    "theme": "light",
    "themeColor": "indigo",
    "sidebarExpanded": true,
    "autoScrollLogs": true,
    "showFilteredMessages": false
  }
}
```

---

### 4. 完整初始化

**功能描述**：执行完整初始化，清除所有数据并恢复系统至初始状态

**API 接口**：`POST /api/init/full`

**执行流程**：
1. 执行「账户数据清除」
2. 执行「日志清除」
3. 执行「配置还原」
4. 重置所有内存中的应用状态

**返回结果**：
```json
{
  "accountData": { "success": true, "deletedFiles": [...], "errors": [] },
  "logs": { "success": true, "deletedFiles": [...], "errors": [] },
  "config": { "success": true, "restored": true, "errors": [] },
  "overallSuccess": true
}
```

---

### 5. 获取数据状态

**功能描述**：获取当前系统数据状态

**API 接口**：`GET /api/init/status`

**返回结果**：
```json
{
  "success": true,
  "data": {
    "hasAccounts": true,
    "hasLogs": true,
    "hasConfig": true,
    "hasOpLogs": true
  }
}
```

---

## 使用示例

### 前端调用示例

```javascript
// 清除所有账户
await clearAllAccounts();

// 清除所有日志
await clearAllLogs();

// 还原配置
await restoreSystemConfig();

// 完整初始化
await performFullInit();
```

### cURL 调用示例

```bash
# 清除账户数据
curl -X POST http://localhost:3210/api/init/clear-accounts

# 清除日志
curl -X POST http://localhost:3210/api/init/clear-logs

# 还原配置
curl -X POST http://localhost:3210/api/init/restore-config

# 完整初始化
curl -X POST http://localhost:3210/api/init/full

# 获取状态
curl http://localhost:3210/api/init/status
```

---

## 安全注意事项

1. **数据不可逆**：所有清除操作均不可逆，请谨慎操作
2. **双重确认**：前端界面提供双重确认机制，防止误操作
3. **权限控制**：建议仅对管理员开放此功能
4. **备份建议**：执行初始化前建议先备份重要数据

---

## 文件结构

```
src/
└── init-manager.js    # 初始化管理模块核心代码

public/
└── init-functions.js  # 前端初始化功能函数

docs/
└── INIT_MANAGER.md    # 本文档
```

---

## 代码规范

### 后端模块 (init-manager.js)

- 使用 JSDoc 注释说明函数功能
- 返回统一的错误格式
- 包含错误处理和异常捕获
- 使用 `path.join` 构建文件路径，确保跨平台兼容性

### 前端函数 (init-functions.js)

- 使用 `async/await` 处理异步操作
- 使用 `confirm()` 提供用户确认机制
- 更新界面状态以反映操作结果
- 使用 `showToast()` 提供操作反馈

---

## 注意事项

1. 执行初始化操作后，用户需要重新登录 Telegram 账户
2. 所有转发规则和监听配置将被清除
3. 主题和界面设置将恢复至默认值
4. 建议在执行前导出配置备份