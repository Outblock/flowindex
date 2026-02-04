# Tooling and Local References

This document collects common commands and references for local development and testing.

## Local Endpoints

### Backend API
- URL: `http://localhost:8080`
- Protocol: HTTP + WebSocket
- Start:
  ```bash
  cd backend
  go run main.go
  ```

### Frontend Dev Server
- URL: `http://localhost:5173`
- Stack: Vite + React
- Start:
  ```bash
  cd frontend
  bun run dev
  ```

### Frontend Production Build (local)
- URL: `http://localhost:8085`
- Server: `http-server`
- Start:
  ```bash
  cd frontend
  bun run build
  npx http-server dist -p 8085 -c-1 --cors
  ```

### Database
- Engine: PostgreSQL
- Example DSN: `postgres://user:password@localhost:5432/flowscan?sslmode=disable`

---

## Flow Documentation
- Developer docs: https://developers.flow.com/
- Go SDK: https://github.com/onflow/flow-go-sdk

Common API calls:
```go
// Latest block height
latestBlock, err := flowClient.GetLatestBlock(ctx, false)

// Block by height
block, err := flowClient.GetBlockByHeight(ctx, height)

// Transaction
tx, err := flowClient.GetTransaction(ctx, txID)

// Account info
account, err := flowClient.GetAccountAtLatestBlock(ctx, address)
```

---

## Playwright Tests

### Install
```bash
npm install playwright
# or
bun add playwright
```

### Example Script
File: `test-page.js`

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  const networkErrors = [];
  page.on('pageerror', error => {
    networkErrors.push(error.message);
  });

  try {
    await page.goto('http://localhost:5173/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(5000);

    const title = await page.title();
    const bodyText = await page.locator('body').innerText();

    console.log('Page Title:', title);
    console.log('Body has content:', bodyText.length > 0);

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

### Run Tests
```bash
# Homepage
node test-page.js

# Block detail
node test-block-page.js

# Transaction detail
node test-tx-page.js

# Account detail
node test-account-page.js
```

---

## PostgreSQL Notes

### Connect
```bash
psql postgres://user:password@localhost:5432/flowscan
```

### Common Queries
```sql
-- Latest 10 blocks
SELECT height, id, timestamp FROM raw.blocks ORDER BY height DESC LIMIT 10;

-- Latest 10 transactions
SELECT id, block_height, timestamp FROM raw.transactions ORDER BY block_height DESC, transaction_index DESC LIMIT 10;

-- Indexing progress
SELECT * FROM app.indexing_checkpoints ORDER BY updated_at DESC;
```
