const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  // Collect network errors
  const networkErrors = [];
  page.on('pageerror', error => {
    networkErrors.push(error.message);
  });

  try {
    console.log('Testing Block Detail Page...');
    await page.goto('http://localhost:5173/blocks/140895946', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for hydration
    console.log('Waiting for hydration...');
    await page.waitForTimeout(5000);

    // Check if page loaded
    const title = await page.title();
    console.log('Page Title:', title);

    // Check for visible content
    const bodyText = await page.locator('body').innerText();
    console.log('Body has content:', bodyText.length > 0);
    console.log('Body length:', bodyText.length);

    // Check if "Block Details" is visible
    const hasBlockDetails = bodyText.includes('Block Details');
    console.log('Has "Block Details":', hasBlockDetails);

    // Check for errors
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
