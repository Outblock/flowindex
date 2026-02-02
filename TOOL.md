# FlowScan Clone - 工具和参考文档

**用途:** 供 AI Agent 参考的工具使用指南和本地文档索引

---

## 🏃 当前运行实例

### 后端 API
- **地址:** `http://localhost:8080`
- **协议:** HTTP + WebSocket
- **启动命令:**
  ```bash
  cd /Users/hao/clawd/agents/fw-cs/flowscan-clone/backend
  go run main.go
  ```

### 前端开发服务器
- **地址:** `http://localhost:5173`
- **框架:** Vite + React
- **启动命令:**
  ```bash
  cd /Users/hao/clawd/agents/fw-cs/flowscan-clone/frontend
  bun run dev
  ```

### 前端生产构建
- **地址:** `http://localhost:8085`
- **服务器:** http-server
- **启动命令:**
  ```bash
  cd /Users/hao/clawd/agents/fw-cs/flowscan-clone/frontend
  bun run build
  npx http-server dist -p 8085 -c-1 --cors
  ```

### 数据库
- **类型:** PostgreSQL
- **数据库名:** `flowscan`
- **连接字符串:** `postgres://user:pass@localhost/flowscan?sslmode=disable`

---

## 📚 本地参考文档

### Clawdbot 文档
- **位置:** `/Users/hao/.bun/install/global/node_modules/clawdbot/docs`
- **在线镜像:** https://docs.clawd.bot
- **内容:**
  - Clawdbot 命令和配置
  - Tool 使用指南
  - Skills 开发文档

### Flow 区块链文档
- **官方文档:** https://developers.flow.com/
- **Go SDK:** https://github.com/onflow/flow-go-sdk
- **关键 API:**
  ```go
  // 获取最新区块高度
  latestBlock, err := flowClient.GetLatestBlock(ctx, false)
  
  // 获取指定高度区块
  block, err := flowClient.GetBlockByHeight(ctx, height)
  
  // 获取交易
  tx, err := flowClient.GetTransaction(ctx, txID)
  
  // 获取账户信息
  account, err := flowClient.GetAccountAtLatestBlock(ctx, address)
  ```

### React Router 文档
- **官方文档:** https://reactrouter.com/
- **本地示例:** `/Users/hao/clawd/agents/fw-cs/flowscan-clone/frontend/src/App.jsx`
- **路由配置:**
  ```jsx
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/blocks/:height" element={<BlockDetail />} />
    <Route path="/transactions/:txId" element={<TransactionDetail />} />
    <Route path="/accounts/:address" element={<AccountDetail />} />
  </Routes>
  ```

---

## 🧪 Playwright 自动化测试

### 安装
```bash
npm install playwright
# 或
bun add playwright
```

### 使用示例
**文件位置:** `/Users/hao/clawd/agents/fw-cs/flowscan-clone/test-page.js`

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 监听 console 和错误
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  const networkErrors = [];
  page.on('pageerror', error => {
    networkErrors.push(error.message);
  });

  try {
    // 访问页面
    await page.goto('http://localhost:5173/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // 等待渲染
    await page.waitForTimeout(5000);

    // 获取页面内容
    const title = await page.title();
    const bodyText = await page.locator('body').innerText();
    
    console.log('Page Title:', title);
    console.log('Body has content:', bodyText.length > 0);

    // 检查错误
    const errors = consoleMessages.filter(m => m.type === 'error');
    console.log('Console Errors:', errors);
    console.log('Page Errors:', networkErrors);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
```

### 运行测试
```bash
cd /Users/hao/clawd/agents/fw-cs/flowscan-clone

# 主页测试
node test-page.js

# 区块详情测试
node test-block-page.js

# 交易详情测试
node test-tx-page.js

# 账户详情测试
node test-account-page.js
```

### Playwright API 常用方法
```javascript
// 导航
await page.goto(url)

// 等待
await page.waitForTimeout(ms)
await page.waitForSelector(selector)

// 获取元素
const element = await page.locator(selector)
const text = await element.innerText()
const html = await element.innerHTML()

// 点击
await page.click(selector)

// 输入
await page.fill(selector, text)

// 截图
await page.screenshot({ path: 'screenshot.png' })
```

---

## 🌐 Chrome DevTools MCP

### 概念
MCP (Model Context Protocol) 是 Anthropic 推出的协议，允许 AI Agent 通过工具与浏览器交互。

### Clawdbot 中的 Browser Tool
Clawdbot 内置了 `browser` tool，支持：
- 打开网页
- 截图
- 抓取页面内容
- 执行 JavaScript
- 模拟点击和输入

### 使用示例（在 Clawdbot Agent 内）

#### 打开页面并截图
```javascript
// 通过 browser tool
browser({
  action: 'open',
  targetUrl: 'http://localhost:5173/',
  profile: 'chrome'
})

browser({
  action: 'screenshot',
  targetId: 'tab_id_from_previous_call'
})
```

#### 获取页面快照
```javascript
browser({
  action: 'snapshot',
  targetId: 'tab_id'
})
```

#### 执行 JavaScript
```javascript
browser({
  action: 'act',
  targetId: 'tab_id',
  request: {
    kind: 'evaluate',
    fn: 'document.querySelector("body").innerText'
  }
})
```

### 参考文档
- **Clawdbot Browser Skill:** `/Users/hao/.bun/install/global/node_modules/clawdbot/docs/tools/browser.md`

---

## 🗄️ LanceDB 向量数据库

### 概念
LanceDB 是一个高性能的向量数据库，适用于 AI 应用的语义搜索和相似性查询。

### 安装
```bash
npm install vectordb
# 或
bun add vectordb
```

### 使用示例

#### 创建数据库和表
```javascript
const lancedb = require('vectordb');

// 连接数据库
const db = await lancedb.connect('/path/to/lancedb');

// 创建表
const table = await db.createTable('documents', [
  { id: 1, text: 'Hello world', vector: [0.1, 0.2, 0.3] },
  { id: 2, text: 'AI is amazing', vector: [0.4, 0.5, 0.6] }
]);
```

#### 向量搜索
```javascript
// 查询相似向量
const results = await table
  .search([0.15, 0.25, 0.35])  // 查询向量
  .limit(5)                     // 返回 top 5
  .execute();

console.log(results);
```

#### 添加数据
```javascript
await table.add([
  { id: 3, text: 'New document', vector: [0.7, 0.8, 0.9] }
]);
```

#### 过滤查询
```javascript
const results = await table
  .search([0.1, 0.2, 0.3])
  .where('id > 1')
  .limit(10)
  .execute();
```

### 在 FlowScan 中的应用场景
1. **语义搜索交易:** 根据交易内容相似性搜索
2. **智能合约相似度:** 找出相似的智能合约代码
3. **地址行为分析:** 基于交易模式聚类地址

### 参考文档
- **官方文档:** https://lancedb.github.io/lancedb/
- **Clawdbot Triple Memory Skill:** `/Users/hao/clawd/skills/triple-memory-skill/`

---

## 📝 PostgreSQL 数据库

### 连接
```bash
# CLI 连接
psql -d flowscan

# 通过 Go
import "github.com/jackc/pgx/v5/pgxpool"

pool, err := pgxpool.New(ctx, "postgres://user:pass@localhost/flowscan")
```

### 常用查询

#### 查看表结构
```sql
\d blocks
\d transactions
```

#### 查询最新数据
```sql
-- 最新 10 个区块
SELECT * FROM blocks ORDER BY height DESC LIMIT 10;

-- 最新 10 笔交易
SELECT * FROM transactions ORDER BY block_height DESC LIMIT 10;

-- 索引进度
SELECT * FROM indexing_checkpoints;
```

#### 统计数据
```sql
-- 区块总数
SELECT COUNT(*) FROM blocks;

-- 交易总数
SELECT COUNT(*) FROM transactions;

-- 每个区块的交易数量
SELECT height, COUNT(*) as tx_count 
FROM transactions 
GROUP BY height 
ORDER BY height DESC 
LIMIT 10;
```

### Schema 文件
**位置:** `/Users/hao/clawd/agents/fw-cs/flowscan-clone/backend/schema.sql`

---

## 🔧 Go 工具

### 常用命令
```bash
# 运行
go run main.go

# 构建
go build -o flowscan-api

# 格式化代码
go fmt ./...

# 安装依赖
go mod tidy

# 更新依赖
go get -u ./...
```

### Go 常用库

#### HTTP 路由 (Gorilla Mux)
```go
import "github.com/gorilla/mux"

r := mux.NewRouter()
r.HandleFunc("/blocks", handleBlocks).Methods("GET")
r.HandleFunc("/blocks/{id}", handleBlock).Methods("GET")
```

#### WebSocket (Gorilla WebSocket)
```go
import "github.com/gorilla/websocket"

upgrader := websocket.Upgrader{
  CheckOrigin: func(r *http.Request) bool { return true },
}

conn, err := upgrader.Upgrade(w, r, nil)
```

#### PostgreSQL (pgx)
```go
import "github.com/jackc/pgx/v5/pgxpool"

pool, err := pgxpool.New(ctx, dbURL)
rows, err := pool.Query(ctx, "SELECT * FROM blocks LIMIT 10")
```

---

## 🎨 前端工具

### Bun 命令
```bash
# 安装依赖
bun install

# 开发服务器
bun run dev

# 生产构建
bun run build

# 预览构建
bun run preview
```

### Vite 配置
**位置:** `/Users/hao/clawd/agents/fw-cs/flowscan-clone/frontend/vite.config.js`

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
```

### TailwindCSS
**配置文件:** `frontend/tailwind.config.js`

**常用类:**
```html
<!-- 布局 -->
<div className="flex items-center justify-between">

<!-- 间距 -->
<div className="p-4 m-2 space-y-4">

<!-- 颜色 -->
<div className="bg-slate-900 text-slate-100 border border-slate-700">

<!-- 响应式 -->
<div className="w-full md:w-1/2 lg:w-1/3">
```

---

## 🚀 未来计划：Swagger API 文档

### 目标
公开一个标准化的 Swagger/OpenAPI 文档，方便第三方接入。

### 实现方案

#### 1. 使用 `swaggo/swag` (推荐)
```bash
# 安装
go install github.com/swaggo/swag/cmd/swag@latest

# 在代码中添加注释
// @title FlowScan API
// @version 1.0
// @description Flow 区块链浏览器 API
// @host localhost:8080
// @BasePath /

// @Summary Get recent blocks
// @Description Get a list of recent blocks
// @Tags blocks
// @Accept json
// @Produce json
// @Param limit query int false "Limit" default(20)
// @Success 200 {array} models.Block
// @Router /blocks [get]
func (s *Server) handleListBlocks(w http.ResponseWriter, r *http.Request) {
  // ...
}

# 生成文档
swag init
```

**访问:** `http://localhost:8080/swagger/index.html`

---

#### 2. 手写 OpenAPI Spec
**位置:** `backend/docs/openapi.yaml`

```yaml
openapi: 3.0.0
info:
  title: FlowScan API
  version: 1.0.0
  description: Flow 区块链浏览器 API

servers:
  - url: http://localhost:8080
    description: 本地开发服务器

paths:
  /blocks:
    get:
      summary: 获取区块列表
      tags:
        - Blocks
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Block'

  /blocks/{id}:
    get:
      summary: 获取区块详情
      tags:
        - Blocks
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Block'

components:
  schemas:
    Block:
      type: object
      properties:
        height:
          type: integer
        id:
          type: string
        parent_id:
          type: string
        timestamp:
          type: string
          format: date-time
        txCount:
          type: integer
```

**集成 Swagger UI:**
```bash
# 下载 Swagger UI
wget https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.0.0.tar.gz

# 解压到 backend/docs/swagger-ui/
# 修改 index.html，指向 openapi.yaml
```

---

#### 3. 推荐的 API 端点规范

```
GET    /api/v1/blocks              # 区块列表
GET    /api/v1/blocks/:id          # 区块详情（支持 height 或 ID）
GET    /api/v1/transactions        # 交易列表
GET    /api/v1/transactions/:id    # 交易详情
GET    /api/v1/accounts/:address   # 账户信息
GET    /api/v1/accounts/:address/transactions  # 账户交易
GET    /api/v1/search              # 搜索（区块/交易/地址）
GET    /api/v1/status              # 网络状态
WS     /api/v1/ws                  # WebSocket 实时推送
```

---

## 📖 其他参考资源

### Clawdbot Skills
- **Apple Calendar:** `/Users/hao/clawd/skills/apple-calendar/SKILL.md`
- **GitHub:** `/Users/hao/.bun/install/global/node_modules/clawdbot/skills/github/SKILL.md`
- **Notion:** `/Users/hao/.bun/install/global/node_modules/clawdbot/skills/notion/SKILL.md`
- **QMD Search:** `/Users/hao/clawd/skills/qmd-skill/SKILL.md`
- **Triple Memory:** `/Users/hao/clawd/skills/triple-memory-skill/SKILL.md`

### 在线资源
- **Flow Developers:** https://developers.flow.com/
- **React 文档:** https://react.dev/
- **TailwindCSS 文档:** https://tailwindcss.com/docs
- **PostgreSQL 文档:** https://www.postgresql.org/docs/
- **Playwright 文档:** https://playwright.dev/

---

## 🔍 调试技巧

### 查看后端日志
```bash
cd backend
go run main.go 2>&1 | tee -a backend.log
```

### 查看前端 Network 请求
浏览器 DevTools (F12) → Network 标签

### 测试 API
```bash
# 使用 curl
curl http://localhost:8080/blocks?limit=5

# 使用 httpie（更友好）
http http://localhost:8080/blocks limit==5

# 使用 Postman 或 Insomnia
```

### 测试 WebSocket
```javascript
// 浏览器 Console
const ws = new WebSocket('ws://localhost:8080/ws');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Received:', JSON.parse(e.data));
ws.onerror = (e) => console.error('Error:', e);
```

---

## 📦 项目文件树

```
flowscan-clone/
├── backend/
│   ├── main.go                     # 入口
│   ├── schema.sql                  # 数据库 schema
│   ├── internal/
│   │   ├── api/
│   │   │   └── server.go           # HTTP + WebSocket 服务器
│   │   ├── flow/
│   │   │   └── client.go           # Flow 客户端
│   │   ├── ingester/
│   │   │   └── service.go          # 数据索引器
│   │   ├── models/
│   │   │   └── models.go           # 数据模型
│   │   └── repository/
│   │       └── postgres.go         # 数据库操作
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # 路由配置
│   │   ├── api.js                  # API 客户端
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── BlockDetail.jsx
│   │   │   ├── TransactionDetail.jsx
│   │   │   └── AccountDetail.jsx
│   │   └── hooks/
│   │       └── useWebSocket.js
│   ├── package.json
│   └── vite.config.js
├── test-page.js                    # Playwright 主页测试
├── test-block-page.js              # Block 详情测试
├── test-tx-page.js                 # Transaction 详情测试
├── test-account-page.js            # Account 详情测试
├── PROJECT_STATUS.md               # 项目状态报告
├── FEATURES_ADDED.md               # 功能清单
└── TOOL.md                         # 本文档
```

---

## ✅ 快速启动 Checklist

- [ ] 启动 PostgreSQL: `psql -d flowscan`
- [ ] 启动后端: `cd backend && go run main.go`
- [ ] 启动前端: `cd frontend && bun run dev`
- [ ] 访问主页: `http://localhost:5173`
- [ ] 测试 API: `curl http://localhost:8080/health`
- [ ] 运行测试: `node test-page.js`

---

**文档完成！** 🚀

供 AI Agent 快速上手开发和调试。如有疑问，参考代码注释或在线文档。
