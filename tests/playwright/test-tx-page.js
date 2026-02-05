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
    console.log('Testing Transaction Detail Page...');
    // Get a transaction ID from the home page first
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Click on the first transaction link
    const firstTxLink = await page.locator('a[href^="/transactions/"]').first();
    const txHref = await firstTxLink.getAttribute('href');
    console.log('Testing transaction:', txHref);
    
    await page.goto(`http://localhost:5173${txHref}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    console.log('Page Title:', title);

    const bodyText = await page.locator('body').innerText();
    console.log('Body has content:', bodyText.length > 0);
    console.log('Body length:', bodyText.length);
    console.log('Has "Transaction Details":', bodyText.includes('Transaction Details'));

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
