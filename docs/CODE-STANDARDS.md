# TG·Push 代码规范标准

## 目录
1. [命名规范](#命名规范)
2. [代码结构](#代码结构)
3. [注释规范](#注释规范)
4. [错误处理](#错误处理)
5. [Git提交规范](#git提交规范)

---

## 命名规范

### 变量和函数命名
| 类型 | 规范 | 示例 |
|------|------|------|
| 普通变量 | 驼峰式 (camelCase) | `userName`, `messageCount` |
| 常量 | 大写下划线 (UPPER_SNAKE_CASE) | `MAX_LOGS`, `API_BASE_URL` |
| 布尔值 | 以 is/has/can/should 开头 | `isConnected`, `hasPermission`, `canEdit`, `shouldRetry` |
| 函数 | 驼峰式 (camelCase) | `getUser()`, `formatMessage()` |
| 类 | 帕斯卡式 (PascalCase) | `MessageForwarder`, `ApiClient` |
| 私有属性/方法 | 下划线前缀 | `_internalMethod()`, `_privateVar` |
| 事件处理函数 | on 前缀 + 事件名 | `onMessageReceived()`, `onError()` |

### 文件名命名
- 小写字母 + 连字符: `message-forwarder.js`, `api-client.js`
- 常量配置文件: `constants.js` 或大写下划线
- 工具函数: 放在 `utils/` 目录下，单个功能一个文件

### 避免的命名
- 避免单字母变量名（循环变量 i,j 等除外）
- 避免使用保留字或关键字
- 避免匈牙利命名法（如 `strName`, `intCount`）
- 避免过度缩写（使用完整单词保证可读性）

---

## 代码结构

### 文件结构组织
```
src/
├── config/
│   └── app-config.js       # 应用配置
├── models/
│   └── ...                # 数据模型
├── services/
│   └── ...                # 业务服务
├── controllers/
│   └── ...                # API控制器
├── middlewares/
│   └── ...                # 中间件
├── utils/
│   ├── helpers.js         # 通用工具函数
│   ├── logger.js          # 日志工具
│   └── error-handler.js   # 错误处理
└── server.js              # 入口文件
```

### 函数编写原则
1. **单一职责**：每个函数只做一件事，且做好一件事
2. **尽量短小**：理想长度 10-30 行，超过 50 行考虑拆分
3. **参数控制**：建议不超过 3 个参数，超过考虑使用对象
4. **避免副作用**：避免在函数内部修改外部状态

### 函数结构示例
```javascript
/**
 * 处理接收到的消息
 * @param {Object} message - 消息对象
 * @param {Object} context - 上下文信息
 * @returns {Promise<Object>} 处理结果
 */
async function processReceivedMessage(message, context) {
  // 1. 参数校验
  if (!message?.id) {
    throw new Error('无效的消息');
  }
  
  // 2. 业务逻辑
  const formatted = formatMessage(message);
  const routed = await routeMessage(formatted, context);
  
  // 3. 返回结果
  return routed;
}
```

---

## 注释规范

### 何时需要注释
- **公共 API** 必须有 JSDoc 注释
- **复杂算法或业务逻辑** 需要说明思路
- **特殊约定或修复** 需要说明原因
- **易误解的代码** 需要澄清意图

### 何时不需要注释
- 代码本身已经很清晰
- 重复说明功能的注释

### JSDoc 注释格式
```javascript
/**
 * 函数功能描述
 * 
 * @param {Type} paramName - 参数描述
 * @param {Object} [optionalParam] - 可选参数描述
 * @returns {Promise<Type>} 返回值描述
 * @throws {Error} 错误类型和情况
 * @example
 * // 使用示例
 * const result = await functionName(param);
 */
```

### 文件头部注释
```javascript
/**
 * 文件简短描述
 * 
 * 详细说明...
 * 
 * @module ModuleName
 * @author AuthorName
 * @since 1.0.0
 */
```

---

## 错误处理

### 错误类型
```javascript
// 使用 AppError 类
throw new AppError('消息发送失败', {
  code: 'MESSAGE_SEND_FAILED',
  severity: ErrorSeverity.ERROR,
  context: { messageId: '123', recipientId: '456' },
  cause: originalError
});
```

### 错误处理原则
1. **不忽略错误**：总是处理 catch 块
2. **提供上下文**：错误信息应该包含足够的调试信息
3. **不静默失败**：失败要记录日志或通知用户
4. **使用中间件**：统一错误响应格式

### 安全执行
```javascript
const result = await safeExecute(async () => {
  return await riskyOperation();
}, {
  fallback: null,
  onError: (error) => {
    logger.warn('操作失败，但已回退', { error });
  }
});
```

---

## Git提交规范

### 提交信息格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型
| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复bug |
| docs | 文档更新 |
| style | 格式/样式调整（不影响代码运行） |
| refactor | 重构（既不增新功能也不修复bug） |
| perf | 性能优化 |
| test | 测试相关 |
| chore | 构建/工具链相关 |

### 示例
```
feat(accounts): 添加账户自动登录功能

- 实现保存/读取登录凭证
- 添加自动登录开关
- 完善错误处理

Closes #123
```

---

## 质量检查清单

提交代码前请检查：
- [ ] 代码有适当的注释
- [ ] 没有console.log调试代码
- [ ] 错误处理完整
- [ ] 命名符合规范
- [ ] 没有引入安全隐患
- [ ] 语法检查通过
- [ ] 已测试基本功能
