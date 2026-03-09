import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for Flow Emulator integration.
 *
 * Prerequisites (handled by playwright.config.ts webServer):
 *   1. Flow emulator running on localhost:8888
 *   2. Runner dev server running on localhost:5199
 */

/** Set Monaco editor content by evaluating JS on the page. */
async function setEditorContent(page: Page, code: string) {
  await page.evaluate((c) => {
    // Monaco exposes models globally
    const model = (window as any).monaco?.editor?.getModels()?.[0];
    if (model) {
      model.setValue(c);
    }
  }, code);
  // Small delay for the editor to process
  await page.waitForTimeout(300);
}

/** Switch to emulator network and wait for connection. */
async function switchToEmulator(page: Page) {
  const networkBtn = page.locator('button', { hasText: /Mainnet|Testnet|Emulator/ }).first();
  await networkBtn.click();
  await page.locator('button', { hasText: 'Emulator' }).click();
  // Wait for green connection dot
  await expect(networkBtn.locator('span.bg-emerald-400')).toBeVisible({ timeout: 10_000 });
}

test.describe('Flow Emulator Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the editor to load
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    // Wait a bit for Monaco to fully initialize
    await page.waitForTimeout(1000);
  });

  test('can switch to Emulator network', async ({ page }) => {
    const networkBtn = page.locator('button', { hasText: /Mainnet|Testnet|Emulator/ }).first();
    await networkBtn.click();
    await page.locator('button', { hasText: 'Emulator' }).click();
    await expect(networkBtn).toContainText('Emulator');
  });

  test('shows green dot when emulator is connected', async ({ page }) => {
    const networkBtn = page.locator('button', { hasText: /Mainnet|Testnet|Emulator/ }).first();
    await networkBtn.click();
    await page.locator('button', { hasText: 'Emulator' }).click();
    const greenDot = networkBtn.locator('span.bg-emerald-400');
    await expect(greenDot).toBeVisible({ timeout: 10_000 });
  });

  test('shows Service Account signer in emulator mode', async ({ page }) => {
    await switchToEmulator(page);
    await expect(page.locator('text=Service Account')).toBeVisible({ timeout: 5_000 });
  });

  test('can execute a Cadence script on emulator', async ({ page }) => {
    await switchToEmulator(page);

    // Set script via Monaco API (keyboard typing gets mangled by autocomplete)
    await setEditorContent(page, 'access(all) fun main(): String { return "hello emulator" }');

    // Click Run Script
    await page.locator('button', { hasText: /Run Script/ }).click();

    // Verify result contains "hello emulator"
    await expect(page.locator('text=hello emulator').last()).toBeVisible({ timeout: 15_000 });
  });

  test('can send a transaction on emulator', async ({ page }) => {
    await switchToEmulator(page);

    // Set transaction code via Monaco API
    await setEditorContent(page, `transaction {
  prepare(signer: &Account) {
    log("emulator tx works")
  }
}`);

    // Wait for button text to update to "Send Transaction"
    const sendBtn = page.locator('button', { hasText: /Send Transaction/ });
    await expect(sendBtn).toBeVisible({ timeout: 5_000 });
    await sendBtn.click();

    // Wait for tx submitted — confirms signing + submission work
    await expect(
      page.locator('text=tx submitted').or(page.locator('text=tx_submitted'))
    ).toBeVisible({ timeout: 15_000 });

    // Verify a transaction ID is displayed
    await expect(page.locator('text=tx:').first()).toBeVisible({ timeout: 5_000 });
  });

  test('can switch back to mainnet after using emulator', async ({ page }) => {
    const networkBtn = page.locator('button', { hasText: /Mainnet|Testnet|Emulator/ }).first();

    // Switch to emulator
    await networkBtn.click();
    await page.locator('button', { hasText: 'Emulator' }).click();
    await expect(networkBtn).toContainText('Emulator');

    // Switch back to mainnet
    await networkBtn.click();
    await page.locator('button', { hasText: 'Mainnet' }).click();
    await expect(networkBtn).toContainText('Mainnet');

    // Signer should no longer show "Service Account"
    await expect(page.locator('text=Service Account')).not.toBeVisible();
  });
});
