import { expect, test, type Page } from '@playwright/test';

const fixture = (path: string) => `${process.env.FIXTURE_ORIGIN}${path}`;

const original = (page: Page) => page.getByRole('region', { name: 'Original' });
const processed = (page: Page) => page.getByRole('region', { name: 'Processed' });

async function expectImage(page: Page, panel: ReturnType<typeof original>) {
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByRole('img')).toBeVisible();
}

async function run(page: Page) {
  await page.getByRole('button', { name: /^(Process image|Get thumbnail)$/ }).click();
}

/** The format dropdown is custom, not a native <select>. */
async function chooseFormat(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: label }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows an empty state and a healthy API', async ({ page }) => {
  await expect(page.getByText('API v')).toBeVisible();
  await expect(
    original(page).getByText('Pick a source and press the button to start.'),
  ).toBeVisible();
  await expect(page.getByText('The exact API request will appear here')).toBeVisible();
});

test('processes an image and compares it with the original', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await run(page);

  await expectImage(page, original(page));
  await expectImage(page, processed(page));
  await expect(original(page).getByText('800 × 600')).toBeVisible();
  await expect(original(page).getByText('JPEG', { exact: true })).toBeVisible();

  await page.getByLabel('Width').fill('200');
  await chooseFormat(page, 'WebP');
  await run(page);

  await expect(page.getByTestId('request-url')).toContainText('width=200&format=webp');
  await expect(processed(page).getByText('200 × 150')).toBeVisible();
  await expect(processed(page).getByText('WEBP', { exact: true })).toBeVisible();
  await expect(processed(page).getByText(/% (smaller|larger) than the original/)).toBeVisible();
  await expect(processed(page).getByText(/^(HIT|MISS)$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/playground-image.png', fullPage: true });
});

test('highlights the field the API rejected', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel('Width').fill('99999');
  await run(page);

  const banner = page.getByTestId('error-banner');
  await expect(banner).toContainText('Invalid parameter');
  await expect(banner).toContainText('INVALID_PARAMETER');
  await expect(banner).toContainText('width must be a whole number from 1 to 4000');
  await expect(page.getByLabel('Width')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: 'from 1 to 4000' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/playground-error.png', fullPage: true });

  await page.getByLabel('Width').fill('300');
  await run(page);
  await expect(banner).toBeHidden();
  await expect(page.getByLabel('Width')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(processed(page).getByText('300 × 225')).toBeVisible();
});

test('explains unsupported sources', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/page.html'));
  await run(page);

  await expect(page.getByTestId('error-banner')).toContainText('UNSUPPORTED_MEDIA_TYPE');
  await expect(page.getByTestId('error-banner')).toContainText('(got text/html)');
});

test('blocks private addresses (SSRF protection is visible in the UI)', async ({ page }) => {
  await page.getByRole('button', { name: 'Private address' }).click();
  await run(page);

  await expect(page.getByTestId('error-banner')).toContainText('FORBIDDEN_HOST');
});

test('extracts video thumbnails', async ({ page }) => {
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Video URL').fill(fixture('/clip.mp4'));
  await page.getByLabel('Frame at').fill('1.5');
  await run(page);

  await expectImage(page, processed(page));
  await expect(page.getByTestId('request-url')).toContainText('/video/thumbnail?url=');
  await expect(page.getByTestId('request-url')).toContainText('time=1.5');
  await expect(original(page).getByText('MP4', { exact: true })).toBeVisible();
  await expect(original(page).getByText('2.00 s')).toBeVisible();
});

test('copies the request URL and a curl command', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel('Width').fill('120');
  await run(page);
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
  await run(page);

  await expectImage(page, processed(page));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/playground-mobile.png', fullPage: true });
});

test('asks in plain words whether to transform an image or a video', async ({ page }) => {
  await expect(page.getByText('What do you want to transform?')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Image' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect(page.getByLabel('Video URL')).toBeVisible();
  await expect(page.getByLabel('Frame at')).toBeVisible();
});

test('rotate, flip, fit and grayscale controls map to API parameters', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel('Width').fill('100');
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await page.getByRole('radio', { name: 'pad' }).click();
  await page.getByRole('button', { name: 'Horizontal' }).click();
  await page.getByRole('button', { name: 'Vertical' }).click();
  await page.getByLabel('Grayscale').click();
  await run(page);

  await expect(page.getByTestId('request-url')).toContainText(
    'width=100&crop=pad&rotate=90&flip=both&grayscale=true',
  );
  await expect(processed(page).getByText('100 × 133')).toBeVisible();
  await page.screenshot({ path: 'test-results/playground-adjusted.png', fullPage: true });

  await page.getByRole('button', { name: 'Reset adjustments' }).click();
  await run(page);
  await expect(page.getByTestId('request-url')).not.toContainText('rotate=');
});

test('does nothing until the button is pressed', async ({ page }) => {
  const runButton = page.getByRole('button', { name: 'Process image' });
  await expect(runButton).toBeDisabled();

  let apiCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/process?')) apiCalls++;
  });
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel('Width').fill('250');
  await page.waitForTimeout(800);

  expect(apiCalls).toBe(0);
  await expect(page.getByText('The exact API request will appear here')).toBeVisible();

  await runButton.click();
  await expect(processed(page).getByText('250 × 188')).toBeVisible();
  expect(apiCalls).toBe(2); // original + processed
});

test('pressing Enter runs it too, and edits are flagged until applied', async ({ page }) => {
  await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
  await page.getByLabel('Image URL').press('Enter');
  await expectImage(page, processed(page));

  await page.getByLabel('Width').fill('90');
  await expect(page.getByText("You have changes that haven't been applied.")).toBeVisible();
  await expect(page.getByTestId('request-url')).not.toContainText('width=90');

  await page.getByLabel('Width').press('Enter');
  await expect(page.getByTestId('request-url')).toContainText('width=90');
  await expect(page.getByText("You have changes that haven't been applied.")).toBeHidden();
});

test('the button says what it will do', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Process image' })).toBeVisible();
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect(page.getByRole('button', { name: 'Get thumbnail' })).toBeVisible();
});

// Common laptop screens: the run button must be visible without scrolling.
for (const [width, height] of [
  [1024, 640],
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
]) {
  test(`the Process button is visible without scrolling at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/');
    await page.getByLabel('Image URL').fill(fixture('/photo.jpg'));
    await run(page);
    await expectImage(page, processed(page));

    const button = page.getByRole('button', { name: 'Process image' });
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height!);

    // Cards in the results column must not be squashed to fit.
    await expect(page.getByRole('button', { name: 'Copy URL' })).toBeVisible();
    const card = (await page.getByTestId('request-url').boundingBox())!;
    expect(card.height).toBeGreaterThan(20);

    // The page itself doesn't scroll; the controls and results scroll inside.
    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1,
    );
    expect(pageScrolls).toBe(false);
    if (height === 720) {
      await page.screenshot({ path: 'test-results/playground-1280x720.png' });
    }
  });
}

test('the controls scroll inside the card while the button stays put', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const button = page.getByRole('button', { name: 'Process image' });
  await expect(button).toBeInViewport();
  const before = (await button.boundingBox())!.y;

  await page.getByLabel('Grayscale').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Grayscale')).toBeInViewport();

  expect((await button.boundingBox())!.y).toBe(before);
});
