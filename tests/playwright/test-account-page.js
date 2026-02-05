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
    console.log('Testing Account Detail Page...');
    // Test with a known address (payer from transactions)
    await page.goto('http://localhost:5173/accounts/0xa4f27efc66f2aa51', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    console.log('Page Title:', title);

    const bodyText = await page.locator('body').innerText();
    console.log('Body has content:', bodyText.length > 0);
    console.log('Body length:', bodyText.length);
    console.log('Has "Account":', bodyText.includes('Account'));
    console.log('Has address:', bodyText.includes('0xa4f27efc66f2aa51'));

    console.log('\n--- Console Errors ---');
    const errors = consoleMessages.filter(m => m.type === 'error');
    errors.forEach(e => console.log(e.text));

    if (errors.length === 0) {
      console.log('No console errors found!');
    }

    console.log('\n--- Page Errors ---');
    networkErrors.forEach(e => console.log(e));

    if (networkErrors.length === 0) {
      console.log('No page errors found!');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
