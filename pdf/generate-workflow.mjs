import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 1200 } });
  await page.goto(new URL('./workflow.html', import.meta.url).href);
  await page.emulateMedia({ media: 'print' });
  const overflow = await page.locator('.page').evaluateAll(pages => pages.map((page, index) => {
    const footer = page.querySelector('.footer');
    const content = [...page.children].filter(child => child !== footer);
    return { page: index + 1, bottom: Math.max(...content.map(el => el.getBoundingClientRect().bottom)), footerTop: footer.getBoundingClientRect().top };
  }).filter(item => item.bottom > item.footerTop - 8));
  if (overflow.length) throw new Error(`Page content overlaps footer: ${JSON.stringify(overflow)}`);
  await page.pdf({ path: fileURLToPath(new URL('./RHU_LabChain_System_Workflow.pdf', import.meta.url)), format: 'A4', preferCSSPageSize: true, printBackground: true });
  console.log('Created pdf/RHU_LabChain_System_Workflow.pdf (4 pages).');
} finally {
  await browser.close();
}
