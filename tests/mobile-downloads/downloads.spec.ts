import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const reportPath = process.env.DOWNLOAD_FIXTURE_REPORT || 'docs/audits/2026-10-10-fixed-integration.json';
const fixture = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

test('mobile customer selects multiple photos and saves each original filename', async ({ page }) => {
  await page.goto(fixture.guest_share_path);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '选择照片', exact: true }).click();
  await page.getByRole('checkbox').nth(0).click();
  await page.getByRole('checkbox').nth(1).click();
  await page.getByRole('button', { name: /下载.*2/ }).click();
  const dialog = page.getByRole('dialog', { name: '下载已选照片' });
  await expect(dialog).toBeVisible();
  const links = dialog.getByRole('link');
  await expect(links).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    const pending = page.waitForEvent('download');
    await links.nth(index).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/^DSC\d{5}\.(jpg|jpeg)$/i);
    const saved = await download.path();
    expect(fs.statSync(saved!).size).toBeGreaterThan(0);
  }
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
});
