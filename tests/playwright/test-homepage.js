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
    console.log('Testing Homepage with txCount...');
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    console.log('Page Title:', title);

    const bodyText = await page.locator('body').innerText();
    console.log('Body has content:', bodyText.length > 0);
    console.log('Body length:', bodyText.length);
    
    // Check if "txs" text is visible (indicating txCount is showing)
    const hasTxCount = bodyText.includes('txs') || bodyText.includes('tx');
    console.log('Has tx count display:', hasTxCount);
    
    // Get the first block's text
    const firstBlock = await page.locator('a[href^="/blocks/"]').first().innerText();
    console.log('First block text:', firstBlock.substring(0, 100));

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
