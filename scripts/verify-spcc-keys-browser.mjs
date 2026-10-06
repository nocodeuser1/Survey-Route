import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = process.env.SPCC_EVIDENCE_DIR || '/tmp/spcc-browser-evidence';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  for (const width of [390, 1280])
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (r) =>
        new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()
      );
      await page.goto(`http://127.0.0.1:5192/tests/spcc-connections.html?theme=${theme}`);
      const create = page.getByRole('button', { name: 'Create read-only key' });
      await create.waitFor();
      assert.equal(await create.isDisabled(), true);
      await page.getByRole('checkbox').check();
      await create.click();
      await page.getByLabel('New read-only key').waitFor();
      assert.equal(await page.getByLabel('New read-only key').getAttribute('type'), 'password');
      assert.equal(await create.isDisabled(), true);
      await page.getByRole('button', { name: 'Hide key' }).click();
      assert.equal(await page.getByLabel('New read-only key').count(), 0);
      await page.getByRole('button', { name: 'Revoke key' }).first().click();
      await page
        .getByText(/Revoked/)
        .first()
        .waitFor();
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${dir}/source-keys-${width}-${theme}.png`, fullPage: true });
      await page.close();
    }
  console.log(
    'PASS source browser: desktop/mobile light/dark consent, one-time masked key, hide, revoke, no overflow or runtime errors.'
  );
} finally {
  await browser.close();
}
