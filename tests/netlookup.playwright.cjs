const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route('https://w.example/**', async (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname === '/health' ? { ok: true, yahoo: true, ebay: true }
      : u.pathname === '/yahoo' ? { source: 'Yahoo!ショッピング', fetchedAt: new Date().toISOString(), total: 1, items: [{ name: 'ゲームボーイライト シルバー 本体', price: 12800, condition: 'used', url: 'https://y.example/1', image: null, seller: 'テスト店' }] }
      : { source: 'eBay Browse API（出品中）', market: 'EBAY_US', fetchedAt: new Date().toISOString(), total: 2, items: [{ title: 'Game Boy Light Silver', price: '180.00', currency: 'USD', shipping: '20.00', condition: 'Used', url: 'https://e.example/1', image: null, buyingOptions: ['FIXED_PRICE'], location: 'JP' }, { title: 'GB Light Gold', price: '220.00', currency: 'USD', shipping: null, condition: 'Used', url: 'https://e.example/2', image: null, buyingOptions: [], location: 'JP' }] };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-app-key' }, body: JSON.stringify(body) });
  });
  await page.goto('http://localhost:4173/#/settings');
  await page.locator('label.fld', { hasText: '中継サーバーのURL' }).locator('input').fill('https://w.example');
  await page.click('button:has-text("接続テスト")');
  await page.waitForSelector('text=接続OK');
  await page.click('button:has-text("保存（現在")');
  await page.waitForSelector('text=保存しました');
  await page.goto('http://localhost:4173/#/scan');
  await page.fill('input[placeholder^="コードを手入力"]', '4902370536485');
  await page.click('button:has-text("照合")');
  await page.click('button:has-text("Yahoo!・eBay を自動検索")');
  await page.waitForSelector('text=eBay 出品中');
  console.log('ebay block:', (await page.textContent('.netlookup')).replace(/\s+/g, ' ').slice(0, 260));
  await page.click('button:has-text("この名前を使う")');
  console.log('name prefilled:', await page.locator('label.fld', { hasText: '商品名（日本語）' }).locator('input').inputValue());
  await page.screenshot({ path: '/home/claude/shots/10-netlookup.png' });
  await page.goto('http://localhost:4173/#/research');
  await page.waitForSelector('details.research');
  console.log('research items:', await page.locator('details.research').count());
  await page.locator('details.research summary').first().click();
  await page.click('button:has-text("台帳に追加して調べる")');
  await page.waitForTimeout(500);
  console.log('after add url:', page.url().split('#')[1]);
  await page.waitForSelector('text=ネットで調べる');
  await page.click('button:has-text("Yahoo!・eBay を自動検索")');
  await page.waitForSelector('text=出品中の参考価格として保存');
  await page.click('button:has-text("出品中の参考価格として保存")');
  await page.waitForSelector('text=出品中のデータとして保存');
  console.log('saved; evidence:', (await page.locator('.evidence').first().textContent()).replace(/\s+/g, ' ').slice(0, 90));
  await page.goto('http://localhost:4173/#/research'); await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/claude/shots/11-research.png' });
  console.log('errors', errs);
  await b.close();
})();
