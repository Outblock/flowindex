import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for Solidity & Flow EVM support.
 *
 * Prerequisites:
 *   - Runner dev server running on localhost:5199 (no emulator needed)
 *
 * Tests cover: template loading, editor mode switching, and client-side
 * Solidity compilation via solc WASM.
 */

/** Get the active Monaco editor instance. */
function getActiveEditor(page: Page) {
  return page.evaluate(() => {
    // Get the focused/active editor (last one created is usually the active one)
    const editors = (window as any).monaco?.editor?.getEditors?.() ?? [];
    const active = editors[editors.length - 1];
    return active?.getModel()?.getValue() ?? '';
  });
}

/** Set Monaco editor content via the global monaco API. */
async function setEditorContent(page: Page, code: string) {
  await page.evaluate((c) => {
    const editors = (window as any).monaco?.editor?.getEditors?.() ?? [];
    const active = editors[editors.length - 1];
    active?.getModel()?.setValue(c);
  }, code);
  await page.waitForTimeout(300);
}

/** Get Monaco editor content. */
async function getEditorContent(page: Page): Promise<string> {
  return getActiveEditor(page);
}

/** Load a template by clicking it in the AI panel sidebar. */
async function loadTemplate(page: Page, templateName: string) {
  // Open AI panel if not visible — look for Templates section
  const templatesSection = page.locator('text=Templates').first();
  if (!(await templatesSection.isVisible().catch(() => false))) {
    // Try clicking the AI toggle button
    const aiToggle = page.locator('[aria-label="AI"]').or(page.locator('button:has(svg.lucide-bot)')).first();
    if (await aiToggle.isVisible().catch(() => false)) {
      await aiToggle.click();
      await page.waitForTimeout(500);
    }
  }
  // Click the template
  await page.locator('button', { hasText: templateName }).first().click();
  await page.waitForTimeout(500);
}

test.describe('Solidity & Flow EVM', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);
  });

  test('Simple Storage template loads .sol file in editor', async ({ page }) => {
    await loadTemplate(page, 'Simple Storage');

    // Editor should contain Solidity code
    const content = await getEditorContent(page);
    expect(content).toContain('pragma solidity');
    expect(content).toContain('SimpleStorage');
  });

  test('shows Compile button for .sol files', async ({ page }) => {
    await loadTemplate(page, 'Simple Storage');

    // Run button should say "Compile" (not "Run Script")
    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await expect(compileBtn).toBeVisible({ timeout: 5_000 });
  });

  test('can compile Simple Storage contract', async ({ page }) => {
    // Increase timeout — first solc WASM load can be slow
    test.setTimeout(120_000);

    await loadTemplate(page, 'Simple Storage');

    // Click Compile
    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    // Wait for compilation result (solc WASM load + compile)
    // Result panel shows JSON with "compiled": true
    await expect(
      page.locator('.json-tree-string', { hasText: 'SimpleStorage' })
        .or(page.locator('text="compiled"'))
    ).toBeVisible({ timeout: 90_000 });
  });

  test('can compile a custom Solidity contract', async ({ page }) => {
    test.setTimeout(120_000);

    await loadTemplate(page, 'Simple Storage');

    // Replace with a minimal custom contract
    await setEditorContent(page, `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Greeter {
    string public greeting = "Hello Flow EVM";

    function greet() public view returns (string memory) {
        return greeting;
    }
}`);

    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    // Should show Greeter contract in results
    await expect(
      page.locator('.json-tree-string', { hasText: 'Greeter' })
        .or(page.locator('text="bytecodeSize"'))
    ).toBeVisible({ timeout: 90_000 });
  });

  test('shows compilation errors for invalid Solidity', async ({ page }) => {
    test.setTimeout(120_000);

    await loadTemplate(page, 'Simple Storage');

    // Set invalid Solidity
    await setEditorContent(page, `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Broken {
    function foo() public {
        uint256 x = "not a number";
    }
}`);

    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    // Should show a compilation error in the result panel
    await expect(
      page.locator('pre', { hasText: 'TypeError' })
    ).toBeVisible({ timeout: 90_000 });
  });

  test('.sol file shows in file explorer with correct icon', async ({ page }) => {
    await loadTemplate(page, 'Simple Storage');

    // File explorer should show SimpleStorage.sol
    await expect(
      page.locator('text=SimpleStorage.sol')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('ERC-20 template loads and compiles', async ({ page }) => {
    test.setTimeout(120_000);

    await loadTemplate(page, 'ERC-20 Token');

    const content = await getEditorContent(page);
    expect(content).toContain('totalSupply');
    expect(content).toContain('transfer');

    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    await expect(
      page.locator('.json-tree-string', { hasText: 'MyToken' })
        .or(page.locator('text="compiled"'))
    ).toBeVisible({ timeout: 90_000 });
  });

  test('switching between .sol and .cdc files changes button text', async ({ page }) => {
    await loadTemplate(page, 'Cross-VM');

    // Cross-VM template has both .sol and .cdc files
    // Click on the .sol file
    const solFile = page.locator('text=Counter.sol');
    if (await solFile.isVisible().catch(() => false)) {
      await solFile.click();
      await page.waitForTimeout(300);
      await expect(page.locator('button', { hasText: 'Compile' }).first()).toBeVisible();
    }

    // Click on the .cdc file
    const cdcFile = page.locator('text=call_evm.cdc');
    if (await cdcFile.isVisible().catch(() => false)) {
      await cdcFile.click();
      await page.waitForTimeout(300);
      await expect(
        page.locator('button', { hasText: /Run Script|Send Transaction/ }).first()
      ).toBeVisible();
    }
  });
});
