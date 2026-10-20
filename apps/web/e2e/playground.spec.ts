import { expect, test, type Page } from '@playwright/test';

const fixture = (path: string) => `${process.env.FIXTURE_ORIGIN}${path}`;

const original = (page: Page) => page.getByRole('region', { name: 'Original' });
const processed = (page: Page) => page.getByRole('region', { name: 'Processed' });

/** Waits until a panel has finished loading and shows an image. */
async function expectImage(page: Page, panel: ReturnType<typeof original>) {
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByRole('img')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows an empty state and a healthy API', async ({ page }) => {
  await expect(page.getByText('API v')).toBeVisible();
  await expect(original(page).getByText('Enter a URL or pick a sample to start.')).toBeVisible();
  await expect(page.getByText('The exact API request will appear here')).toBeVisible();
});

test('processes an image and compares it with the original', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));

  await expectImage(page, original(page));
  await expectImage(page, processed(page));
  await expect(original(page).getByText('800 × 600')).toBeVisible();
  await expect(original(page).getByText('jpeg')).toBeVisible();

  await page.getByLabel(/^Width/).fill('200');
  await page.getByLabel(/^Format/).selectOption('webp');

  await expect(page.getByTestId('request-url')).toContainText('width=200&format=webp');
  await expect(processed(page).getByText('200 × 150')).toBeVisible();
  await expect(processed(page).getByText('webp', { exact: true })).toBeVisible();
  await expect(processed(page).getByText(/% (smaller|larger)/)).toBeVisible();
  await expect(processed(page).getByText(/^(HIT|MISS)$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/playground-image.png', fullPage: true });
});

test('highlights the field the API rejected', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel(/^Width/).fill('99999');

  const banner = page.getByTestId('error-banner');
  await expect(banner).toContainText('Invalid parameter');
  await expect(banner).toContainText('INVALID_PARAMETER');
  await expect(banner).toContainText('width must be a whole number from 1 to 4000');
  await expect(page.locator('.field--invalid')).toContainText('Width');
  await page.screenshot({ path: 'test-results/playground-error.png', fullPage: true });

  await page.getByLabel(/^Width/).fill('300');
  await expect(banner).toBeHidden();
  await expect(processed(page).getByText('300 × 225')).toBeVisible();
});

test('explains unsupported sources', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/page.html'));

  await expect(page.getByTestId('error-banner')).toContainText('UNSUPPORTED_MEDIA_TYPE');
  await expect(page.getByTestId('error-banner')).toContainText('(got text/html)');
});

test('blocks private addresses (SSRF protection is visible in the UI)', async ({ page }) => {
  await page.getByRole('button', { name: 'Private address' }).click();

  await expect(page.getByTestId('error-banner')).toContainText('FORBIDDEN_HOST');
});

test('extracts video thumbnails', async ({ page }) => {
  await page.getByText('Video  /video/thumbnail').click();
  await page.getByLabel('Video URL').fill(fixture('/clip.mp4'));
  await page.getByLabel(/^Frame at/).fill('1.5');

  await expectImage(page, processed(page));
  await expect(page.getByTestId('request-url')).toContainText('/video/thumbnail?url=');
  await expect(page.getByTestId('request-url')).toContainText('time=1.5');
  await expect(original(page).getByText('mp4')).toBeVisible();
  await expect(original(page).getByText('2.00 s')).toBeVisible();
});

test('copies the request URL and a curl command', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel(/^Width/).fill('120');
  await expect(page.getByTestId('request-url')).toContainText('width=120');

  await page.getByRole('button', { name: 'Copy URL' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3100\/process\?url=.*&width=120$/);

  await page.getByRole('button', { name: 'Copy as curl' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `curl -sS -D - -o output '${url}'`,
  );

  // The copied URL is a working API request on its own.
  const res = await page.request.get(url);
  expect(res.headers()['x-output-width']).toBe('120');
});

test('works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Image URL').fill(fixture('/alpha.png'));

  await expectImage(page, processed(page));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/playground-mobile.png', fullPage: true });
});
