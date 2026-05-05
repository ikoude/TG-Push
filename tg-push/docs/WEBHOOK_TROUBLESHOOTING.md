# Webhook 404 错误排查指南

## 已修复的问题

### 问题1: DEFAULT_CONFIG 缺少 inboundWebhooks 字段
**状态**: ✅ 已修复
**文件**: `src/config.js` (第38-39行)
**修复**: 添加 `inboundWebhooks: []` 到默认配置

---

## 完整排查步骤

### 1. 检查后端服务器是否正常运行
```bash
# 检查服务器进程
ps aux | grep node

# 检查端口监听
lsof -i :3000  # 或你的服务器端口

# 重启服务器
npm start
```

### 2. 验证 API 端点是否正确

| 功能 | 方法 | URL | 说明 |
|------|------|-----|------|
| 获取所有Webhook | GET | `/api/webhook` | 已实现 |
| 创建Webhook | POST | `/api/webhook` | 已实现 |
| 更新Webhook | PUT | `/api/webhook/:id` | 已实现 |
| 删除Webhook | DELETE | `/api/webhook/:id` | 已实现 |
| 发送Webhook消息 | POST | `/api/webhook/:id` | 已实现 |

### 3. 检查网络连接
```bash
# 测试本地API端点 (替换端口为你的实际端口)
curl -X GET http://localhost:3000/api/webhook

# 或使用浏览器访问
# http://localhost:3000/api/webhook
```

### 4. 检查认证凭据
如果您的API需要认证，请确保：
1. 认证类型设置正确（无认证/API Key/Bearer Token）
2. 如果使用认证，密钥正确填写
3. 请求头包含正确的认证信息

**测试认证的请求示例**:
```bash
# 使用 API Key
curl -X POST http://localhost:3000/api/webhook/wh_123456789 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"text": "测试消息"}'

# 使用 Bearer Token
curl -X POST http://localhost:3000/api/webhook/wh_123456789 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{"text": "测试消息"}'
```

### 5. 检查 Webhook 是否存在
```bash
# 获取所有Webhook列表
curl -X GET http://localhost:3000/api/webhook
```

### 6. 检查转发服务器状态
确保关联的转发服务器：
1. 已在系统中配置
2. 已启用（enabled = true）
3. 转发器已正确初始化

### 7. 检查配置文件
检查 `data/config.json` 是否包含：
```json
{
  "inboundWebhooks": [
    {
      "id": "wh_123456789",
      "name": "你的Webhook",
      "forwardTargetId": "srv_magicpush_default",
      "authType": "none",
      "authKey": "",
      "msgFormat": "text",
      "enabled": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## 常见错误及解决方案

### 错误1: Webhook not found (404)
**原因**: Webhook ID 不存在
**解决方案**:
1. 检查您使用的 Webhook URL 是否包含正确的 ID
2. 确认该 ID 在 `/api/webhook` 端点返回的列表中

### 错误2: Forward server not found or disabled (400)
**原因**: 关联的转发服务器不存在或已禁用
**解决方案**:
1. 检查转发服务器是否在系统中配置
2. 确保 `enabled` 字段为 `true`

### 错误3: Forwarder not initialized (400)
**原因**: 转发器实例未初始化
**解决方案**:
1. 重启服务器以确保所有转发器正确初始化
2. 检查转发服务器配置是否正确

### 错误4: Invalid API key / Invalid token (401)
**原因**: 认证信息不正确
**解决方案**:
1. 检查认证类型是否正确配置
2. 确认密钥/令牌与设置一致

---

## 使用测试功能

系统提供内置的 Webhook 测试功能：

1. 在 "账户管理" 卡片中点击 "Webhook" 按钮
2. 创建或编辑现有 Webhook
3. 填写 "测试消息" 输入框
4. 点击 "发送测试消息" 按钮

这样可以快速验证 Webhook 配置是否正确，无需使用外部工具。

---

## 添加调试日志 (高级)

如需进一步调试，可以在 `src/server.js` 中添加日志：

```javascript
app.post('/api/webhook/:id', async (req, res) => {
  console.log('[Webhook Debug] 收到请求:', req.params.id);
  console.log('[Webhook Debug] Headers:', JSON.stringify(req.headers, null, 2));
  // ... 其他代码 ...
});
```
