/**
 * Browser regression coverage for the shared button-help provider.
 *
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
 *   node tests/contextualHelpProvider.browser.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const scratch = join(homedir(), '.codex/tmp');
await mkdir(scratch, { recursive: true });
const output = await mkdtemp(join(scratch, 'survey-contextual-help-'));

await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import ContextualHelpProvider from './src/components/ContextualHelpProvider';
      createRoot(document.getElementById('root')).render(
        <ContextualHelpProvider>
          <button id="reoptimize" title="Apply settings and fully re-optimize route, reassigning facilities for best results">
            Apply & Re-optimize
          </button>
          <button id="outside">Outside</button>
        </ContextualHelpProvider>
      );
    `,
    loader: 'tsx',
    resolveDir: root,
    sourcefile: 'contextual-help-qa.tsx',
  },
  outfile: join(output, 'app.js'),
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
});

await writeFile(join(output, 'index.html'), `<!doctype html>
  <html><body><div id="root"></div><script src="/app.js"></script></body></html>`);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Content-Type', path === '/app.js' ? 'text/javascript' : 'text/html');
  response.end(await readFile(join(output, path === '/app.js' ? 'app.js' : 'index.html')));
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = page.locator('#reoptimize');
  const helpText = 'Apply settings and fully re-optimize route, reassigning facilities for best results';

  await button.hover();
  const tooltip = page.getByRole('tooltip');
  await tooltip.waitFor();
  assert.equal(await tooltip.count(), 1, 'Only the provider tooltip is rendered');
  assert.equal(await tooltip.textContent(), helpText);
  assert.equal(await button.getAttribute('title'), null, 'Native title is suppressed while custom help is visible');
  assert.match(await button.getAttribute('aria-describedby'), /contextual-button-help/);

  await page.locator('#outside').hover();
  await tooltip.waitFor({ state: 'detached' });
  assert.equal(await button.getAttribute('title'), helpText, 'Native title is restored after help closes');
  assert.equal(await button.getAttribute('aria-describedby'), null);

  await button.focus();
  await tooltip.waitFor();
  assert.equal(await tooltip.count(), 1, 'Keyboard focus also renders one help surface');
  assert.equal(await button.getAttribute('title'), null);
  await page.locator('#outside').focus();
  await tooltip.waitFor({ state: 'detached' });
  assert.equal(await button.getAttribute('title'), helpText);

  console.log('PASS: contextual help suppresses duplicate native tooltips on hover and focus');
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
