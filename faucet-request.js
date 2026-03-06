const { chromium } = require('playwright');

const ADDRESS = '0x068aa5a599e2292c8f9457fcdf2026367051307257bea877ffca1ed654948d5c';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    console.log('1. Navigating to https://faucet.starknet.io/');
    await page.goto('https://faucet.starknet.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    console.log('2. Looking for address input field...');
    const addressInput = await page.locator('input[placeholder*="address" i], input[placeholder*="0x" i], input[type="text"]').first();
    await addressInput.waitFor({ state: 'visible', timeout: 10000 });
    await addressInput.fill(ADDRESS);
    console.log('3. Entered address:', ADDRESS);

    await page.waitForTimeout(500);

    console.log('4. Looking for Request STRK button...');
    const requestBtn = page.locator('button:has-text("Request"), button:has-text("100 STRK"), [role="button"]:has-text("STRK")').first();
    await requestBtn.waitFor({ state: 'visible', timeout: 10000 });
    await requestBtn.click();
    console.log('5. Clicked request button. Waiting for confirmation...');

    await page.waitForTimeout(8000);

    await page.screenshot({ path: 'faucet-result.png', fullPage: true });
    console.log('6. Screenshot saved to faucet-result.png');

    const pageText = await page.innerText('body');
    const success = /success|successful|received|sent/i.test(pageText) && !/error|failed|denied/i.test(pageText);
    console.log('7. Result:', success ? 'SUCCESS' : 'Check screenshot for details');
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'faucet-result.png', fullPage: true });
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
