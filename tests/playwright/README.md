# Playwright Smoke Scripts

These are lightweight local smoke scripts used during UI debugging. They are **not** wired into CI.

## Prereqs

- `node` + `npm`
- `playwright` installed (`npm i -D playwright`)
- Frontend running locally on `http://localhost:5173`

## Usage

```bash
node tests/playwright/test-homepage.js
node tests/playwright/test-account-page.js
node tests/playwright/test-block-page.js
node tests/playwright/test-tx-page.js
node tests/playwright/test-page.js
```

## API Tests

Go unit tests live in the backend packages, e.g. `backend/internal/api/*_test.go`.
