import 'dotenv/config';
import { chromium, devices } from 'playwright';
import { loginLinkedIn } from './utils/login.js';
import { setupStealthContext, preparePage } from './utils/stealth.js';

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function main() {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  
  if (!email || !password) {
    console.error('Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

  const headless = String(process.env.HEADLESS || 'false') === 'true';
  const slowMo = Number(process.env.SLOW_MO || 100);
  const userDataDir = process.env.USER_DATA_DIR || null;
  const keepOpen = String(process.env.KEEP_OPEN || '0') === '1';

  console.log(`[${nowTs()}] Starting LinkedIn login test...`);
  console.log(`[${nowTs()}] Config: headless=${headless} slowMo=${slowMo} userDataDir=${userDataDir || 'none'} playwrightVersion=${process.env.npm_package_dependencies_playwright || 'unknown'}`);
  if (keepOpen) console.log(`[${nowTs()}] KEEP_OPEN enabled (window will remain after login).`);

  const launchOpts = {
    headless,
    slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  };

  let browser; let context; let launchMode = userDataDir ? 'persistent' : 'ephemeral';
  const launchStart = Date.now();
  try {
    if (userDataDir) {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOpts,
        viewport: { width: 1366, height: 768 },
        userAgent: devices['Desktop Chrome'].userAgent,
      });
    } else {
      browser = await chromium.launch(launchOpts);
      context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: devices['Desktop Chrome'].userAgent,
      });
    }
    console.log(`[${nowTs()}] Browser/context launched in ${Date.now() - launchStart}ms (mode=${launchMode}).`);
  } catch (launchErr) {
    console.error(`[${nowTs()}] Failed launching Playwright: ${launchErr.message}`);
    console.error('Common fixes:');
    console.error('- Ensure browsers installed: npx playwright install chromium');
    console.error('- Reinstall dependencies: npm install');
    console.error('- If using VPN / corporate device, try disabling restrictions');
    process.exit(1);
  }

  await setupStealthContext(context);
  const page = await context.newPage();
  await preparePage(page);

  try {
    console.log(`[${nowTs()}] Attempting login...`);
    await loginLinkedIn(page, email, password);
  console.log(`[${nowTs()}] ✅ LOGIN SUCCESS! Reached LinkedIn feed.`);
    
    // Optional: wait a few seconds to see the feed
    await page.waitForTimeout(3000);
    
    console.log(`[${nowTs()}] 🎉 Process completed successfully!`);
    if (keepOpen) {
      console.log(`[${nowTs()}] KEEP_OPEN active: not closing browser. Press Ctrl+C to exit.`);
      // Keep process alive indefinitely until user interrupts
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  } catch (error) {
    console.error(`[${nowTs()}] ❌ Login failed:`, error.message);
    process.exit(1);
  } finally {
    if (!keepOpen) {
      if (browser) await browser.close(); else await context.close();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}