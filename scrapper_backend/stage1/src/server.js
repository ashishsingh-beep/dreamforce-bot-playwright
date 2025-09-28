import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runScrape } from './stage1.js';

const app = express();
app.use(cors()); // open CORS per requirement
app.use(express.json({ limit: '1mb' }));

let running = false; // simple concurrency gate

function validatePayload(body) {
  const errors = [];
  if (!body) return ['Missing JSON body'];
  const { emailMode, email, password, accountStatus, accountEmail, keyword, searchUrl, durationSec, userId, tag } = body;
  if (!userId) errors.push('userId is required');
  if (!tag) body.tag = 'not_defined';
  if (durationSec !== undefined && (isNaN(durationSec) || durationSec < 0)) errors.push('durationSec must be >= 0');
  if (emailMode === 'manual') {
    if (!email) errors.push('email required for manual mode');
    if (!password) errors.push('password required for manual mode');
  } else if (emailMode === 'stored') {
    if (!accountStatus) errors.push('accountStatus required for stored mode');
    if (!accountEmail) errors.push('accountEmail required for stored mode');
    // password expected to be provided (frontend fetched) but we don't further validate
  } else {
    errors.push('emailMode must be manual or stored');
  }
  if (keyword && searchUrl) errors.push('Provide only one of keyword or searchUrl');
  if (!keyword && !searchUrl) errors.push('One of keyword or searchUrl required');
  return errors;
}

app.post('/scrape', async (req, res) => {
  if (running) return res.status(409).json({ success: false, message: 'Another scrape is in progress' });
  const errors = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ success: false, errors });
  const {
    emailMode,
    email,
    password,
    accountEmail,
    keyword,
    searchUrl,
    durationSec = 0,
    userId,
    tag = 'not_defined',
    headless
  } = req.body;

  const finalEmail = emailMode === 'stored' ? accountEmail : email;
  const finalPassword = password; // already provided (fetched on frontend per accepted approach)

  running = true;
  let result;
  try {
    result = await runScrape({
      email: finalEmail,
      password: finalPassword,
      keywords: keyword || '',
      searchUrl: searchUrl || '',
      durationSec: Number(durationSec) || 0,
      tag,
      userId,
      headless: typeof headless === 'boolean' ? headless : false,
      keepOpen: false,
      saveJsonFile: true,
    });
  } catch (e) {
    result = { success: false, error: e.message };
  } finally {
    running = false;
  }
  const status = result.success ? 200 : 500;
  res.status(status).json(result);
});

const port = process.env.PORT || 4001;
app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(port, () => console.log(`[server] Stage1 scrape API listening on :${port}`));
