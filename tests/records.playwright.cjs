const { chromium, devices } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const fld = (label) => page.locator('label.fld', { hasText: label }).locator('input, textarea, select').first();
  // 商品を用意
  await page.goto('http://localhost:4173/#/product-new');
  await fld('商品名（日本語）').fill('ゲームボーイライト');
  await fld('地域').fill('日本版');
  await page.click('button:has-text("保存")');
  await page.waitForSelector('text=バーコード');
  // 手動取り込み（ジャンク表記）
  await page.goto('http://localhost:4173/#/import');
  await fld('URL').fill('https://www.ebay.com/itm/Game-Boy-Light/123456789012?_trkparms=x&hash=y');
  await fld('データの種類').selectOption('sold_observation');
  await fld('商品名（原文').fill('Game Boy Light Silver for parts not working');
  await fld('成約価格').fill('80');
  await fld('対応する商品').selectOption({ label: 'ゲームボーイライト' });
  console.log('warn:', await page.locator('.warn-line').allTextContents());
  console.log('url parsed:', (await page.locator('small.muted').first().textContent()));
  await page.click('button:has-text("保存")');
  await page.waitForSelector('text=新しく保存しました');
  // 同じものを再保存 → 件数増えない
  await fld('URL').fill('https://ebay.com/itm/123456789012?mkevt=1');
  await fld('商品名（原文').fill('Game Boy Light Silver for parts not working');
  await fld('成約価格').fill('80');
  console.log('dup warn shown:', await page.isVisible('text=すでに取り込まれています'));
  await page.click('button:has-text("保存")');
  await page.waitForSelector('text=件数は増やしていません');
  // 一覧→詳細→一致確認→採用
  await page.goto('http://localhost:4173/#/records');
  console.log('records count:', await page.locator('.row-card').count());
  await page.click('.row-card');
  await page.click('button:has-text("一致を確認した")');
  await page.waitForSelector('text=照合状態を「一致確認済」');
  console.log('adopt disabled before condition:', await page.locator('button:has-text("成約例として採用")').isDisabled());
  await fld('状態').selectOption('junk');
  await page.waitForTimeout(300);
  await page.click('button:has-text("成約例として採用")');
  await page.waitForSelector('text=成約例として採用しました');
  await page.screenshot({ path: '/home/claude/shots/12-record.png', fullPage: true });
  // CSV
  fs.writeFileSync('/tmp/sold.csv', 'Title,Sold Price,Shipping,Sold Date,URL\n"Game Boy Light Gold",US $200.00,$20.00,2026-10-28,https://www.ebay.com/itm/222222222222\n"Game Boy Light Silver",150,,2026-10-20,https://www.ebay.com/itm/333333333333\nGame Boy Light Gold,US $200.00,$20.00,2026-10-28,https://www.ebay.com/itm/222222222222\n');
  await page.goto('http://localhost:4173/#/import-csv');
  await page.setInputFiles('input[type=file]', '/tmp/sold.csv');
  await page.waitForSelector('text=プレビュー');
  console.log('csv summary:', await page.locator('p.small', { hasText: '新規' }).textContent());
  await page.click('button:has-text("取り込む")');
  await page.waitForSelector('text=取り込み完了');
  console.log('csv result:', await page.locator('p.ok').textContent());
  await page.goto('http://localhost:4173/#/sources');
  console.log('sources cards:', await page.locator('section.card').count());
  await page.screenshot({ path: '/home/claude/shots/13-sources.png' });
  // 商品画面：成約1件が統計に
  await page.goto('http://localhost:4173/#/products');
  await page.click('.row-card:has-text("ゲームボーイライト")');
  await page.waitForSelector('text=取り込みデータ');
  console.log('evidence:', (await page.locator('.evidence').first().textContent()).replace(/\s+/g, ' ').slice(0, 60));
  console.log('errors', errs);
  await b.close();
})();
