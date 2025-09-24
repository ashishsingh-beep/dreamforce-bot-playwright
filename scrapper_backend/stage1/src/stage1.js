import 'dotenv/config';
import { chromium, devices } from 'playwright';
import { loginLinkedIn } from './utils/login.js';
import { setupStealthContext, preparePage } from './utils/stealth.js';
import { saveAllLeads } from './utils/supabase.js';
import { saveJson } from './utils/saveJson.js';

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function main() {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  // Accept either direct search results URL or keywords for search
  // Priority: CLI args override env.
  const argv = process.argv.slice(2);
  const argMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { argMap[key] = next; i++; } else { argMap[key] = true; }
    }
  }

  const searchUrl = argMap.searchUrl || process.env.SEARCH_URL || '';
  const keywords = argMap.keywords || process.env.KEYWORDS || '';
  const durationSec = Number(argMap.duration || process.env.DURATION_SEC || 0); // 0 means skip scrolling phase
  
  if (!email || !password) {
    console.error('Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

  if (!searchUrl && !keywords) {
    console.log('[info] Neither --searchUrl nor --keywords provided. Will stop after login.');
  }
  if (searchUrl && keywords) {
    console.log('[warn] Both searchUrl and keywords supplied. Using searchUrl and ignoring keywords.');
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
    
    // If user wants further action (navigate to posts view)
    if (searchUrl || keywords) {
      if (searchUrl) {
        console.log(`[${nowTs()}] Navigating directly to provided searchUrl...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      } else if (keywords) {
        console.log(`[${nowTs()}] Performing keyword search: "${keywords}"`);
        const searchInput = page.locator("xpath=//input[@placeholder='Search']");
        await searchInput.waitFor({ state: 'visible', timeout: 20000 });
        await searchInput.click({ delay: 80 + Math.random()*120 });
        await searchInput.fill('');
        for (const ch of keywords) {
          await page.keyboard.type(ch, { delay: 80 + Math.floor(Math.random()*90) });
        }
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded');
        // Wait a bit for results layout
        await page.waitForTimeout(2000 + Math.random()*1000);
        // Apply Posts filter button
        const postsBtn = page.locator("xpath=//button[text()='Posts' and ancestor::li[@class='search-reusables__primary-filter']]");
        try {
          await postsBtn.waitFor({ state: 'visible', timeout: 15000 });
          await postsBtn.click({ delay: 120 + Math.random()*180 });
          console.log(`[${nowTs()}] Applied Posts filter.`);
          // Wait for posts content to load
          await page.waitForTimeout(2500 + Math.random()*1200);
        } catch (e) {
          console.warn(`[${nowTs()}] Posts filter button not found or failed to click: ${e.message}`);
        }
      }

      let postCount = 0;
      if (durationSec > 0) {
        console.log(`[${nowTs()}] Starting timed scroll for ${durationSec}s...`);
        const endTime = Date.now() + durationSec * 1000;
        let lastHeight = 0;
        while (Date.now() < endTime) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
          await page.waitForTimeout(600 + Math.random()*700);
          // occasionally small upward scroll to simulate user
            if (Math.random() < 0.18) {
              await page.evaluate(() => window.scrollBy(0, -Math.floor(window.innerHeight * 0.3)));
              await page.waitForTimeout(400 + Math.random()*500);
            }
          const newHeight = await page.evaluate(() => document.body.scrollHeight);
          if (newHeight === lastHeight) {
            // Possibly no more content loading; short wait then continue
            await page.waitForTimeout(1200 + Math.random()*800);
          }
          lastHeight = newHeight;
        }
        console.log(`[${nowTs()}] Timed scroll complete.`);

        // Count posts by xpath: //li[@class="artdeco-card mb2"]
        postCount = await page.locator('xpath=//li[@class="artdeco-card mb2"]').count();
        console.log(`[${nowTs()}] ✅ Loaded post elements count: ${postCount}`);
      } else {
        console.log(`[${nowTs()}] No scrolling duration specified (durationSec=${durationSec}). Skipping scroll phase.`);
      }

      // Reactions collection feature
      if (postCount === 0) {
        postCount = await page.locator('xpath=//li[@class="artdeco-card mb2"]').count();
      }
      console.log(`[${nowTs()}] Beginning reactions harvesting across ${postCount} posts (limited to what's loaded).`);

      const posts = await page.locator('xpath=//li[@class="artdeco-card mb2"]').elementHandles();
      const allLeadsMap = new Map();

      for (let idx = 0; idx < posts.length; idx++) {
        const postHandle = posts[idx];
        try {
          // Scope button search inside each post element for stability
          const reactionsButton = await postHandle.$("xpath=.//button[@data-reaction-details]");
          if (!reactionsButton) {
            console.log(`[${nowTs()}] [Post ${idx+1}] No reactions button found; skipping.`);
            continue;
          }
          await reactionsButton.click({ delay: 120 + Math.random()*150 });
          console.log(`[${nowTs()}] [Post ${idx+1}] Opened reactions modal.`);

          // Wait for modal content container
            const modalSelector = 'xpath=//div[@class="artdeco-modal__content social-details-reactors-modal__content ember-view"]';
            const modal = page.locator(modalSelector);
            await modal.waitFor({ state: 'visible', timeout: 15000 });

          // Scroll inside modal until load more button disappears (not visible for 10s)
          const loadMoreXPath = "xpath=(//button[contains(@id,'ember') and contains(@class,'scaffold-finite-scroll__load-button')])[1]";
          const startScroll = Date.now();
          let lastSeenLoadMore = Date.now();
          while (true) {
            const loadMoreVisible = await page.locator(loadMoreXPath).isVisible().catch(() => false);
            if (loadMoreVisible) lastSeenLoadMore = Date.now();
            // Scroll modal container
            await page.evaluate((sel) => {
              const el = document.evaluate(sel.replace('xpath=',''), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              if (el) el.scrollBy(0, el.clientHeight * 0.8);
            }, modalSelector);
            await page.waitForTimeout(600 + Math.random()*500);
            if (!loadMoreVisible && Date.now() - lastSeenLoadMore > 10000) {
              console.log(`[${nowTs()}] [Post ${idx+1}] Modal fully loaded (no load-more for >10s).`);
              break;
            }
            // Safety cap (avoid infinite loop) ~60 seconds
            if (Date.now() - startScroll > 60000) {
              console.warn(`[${nowTs()}] [Post ${idx+1}] Stopping modal scroll due to time cap.`);
              break;
            }
          }

          // Collect leads from anchors inside modal
          const anchors = await modal.locator('xpath=.//a[@rel="noopener noreferrer" and contains(@href, "/in")]').elementHandles();
          console.log(`[${nowTs()}] [Post ${idx+1}] Found ${anchors.length} user anchor nodes.`);
          for (const a of anchors) {
            try {
              const url = await a.getAttribute('href');
              if (!url) continue;
              const fullUrl = url.startsWith('http') ? url : `https://www.linkedin.com${url}`;
              // Normalize handle from /in/handle/
              const match = fullUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
              if (!match) continue;
              const lead_id = match[1];
              const bio = await a.evaluate(el => {
                // innerText gives rendered, CSS-aware text (excludes hidden); textContent as fallback.
                const raw = (el.innerText || el.textContent || '').trim();
                // Normalize whitespace & collapse multiple blank lines.
                return raw
                  .split(/\n+/)
                  .map(s => s.replace(/\s+/g,' ').trim())
                  .filter(Boolean)
                  .join(' | ');
              });
              if (!allLeadsMap.has(lead_id)) {
                allLeadsMap.set(lead_id, { lead_id, linkedin_url: fullUrl, bio });
              }
            } catch (_) { /* ignore per-anchor errors */ }
          }

          // Close modal explicitly using provided XPath for the cross button
          const dismissXPath = "xpath=(//button[@aria-label='Dismiss'])[1]";
          const dismissBtn = page.locator(dismissXPath);
          if (await dismissBtn.isVisible().catch(()=>false)) {
            await dismissBtn.click({ delay: 80 + Math.random()*140 });
            // Wait until modal content container is detached/hidden
            await page.locator('xpath=//div[@class="artdeco-modal__content social-details-reactors-modal__content ember-view"]').waitFor({ state: 'detached', timeout: 10000 }).catch(()=>{});
          } else {
            // Fallback: try aria-label variant or Escape
            const altClose = page.locator('button[aria-label="Dismiss"]');
            if (await altClose.isVisible().catch(()=>false)) {
              await altClose.click({ delay: 60 + Math.random()*100 });
            } else {
              await page.keyboard.press('Escape').catch(()=>{});
            }
            await page.waitForTimeout(400 + Math.random()*400);
          }
          await page.waitForTimeout(250 + Math.random()*250);
        } catch (e) {
          console.warn(`[${nowTs()}] [Post ${idx+1}] Error collecting reactions: ${e.message}`);
          // Attempt to close modal if stuck
          await page.keyboard.press('Escape').catch(()=>{});
        }
      }

      const collectedLeads = Array.from(allLeadsMap.values());
      console.log(`[${nowTs()}] Total unique leads collected: ${collectedLeads.length}`);

      if (collectedLeads.length) {
        // Save to Supabase (optional if creds provided)
        try {
          if (process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY)) {
            const saveRes = await saveAllLeads(collectedLeads);
            console.log(`[${nowTs()}] Saved/Upserted ${saveRes.inserted} leads to Supabase (table all_leads).`);
          } else {
            console.log(`[${nowTs()}] Supabase env not configured; skipping remote save.`);
          }
        } catch (e) {
          console.error(`[${nowTs()}] Failed saving to Supabase: ${e.message}`);
        }
        // Local JSON
        try {
          const outPath = saveJson(collectedLeads, process.env.OUTPUT_JSON || null, 'reactions-leads');
          console.log(`[${nowTs()}] Wrote leads JSON: ${outPath}`);
        } catch (e) {
          console.error(`[${nowTs()}] Failed writing JSON: ${e.message}`);
        }
      }
    }

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

// if (import.meta.url === `file://${process.argv[1]}`) {
//   main().catch(console.error);
// }

main().catch(console.error);