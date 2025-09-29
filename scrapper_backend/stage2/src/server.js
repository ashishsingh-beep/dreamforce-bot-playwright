import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fork } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// Resolve root & load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// In-memory job registry
const jobs = new Map();

// Shape helper
function createJob(accounts) {
  return {
    jobId: uuidv4(),
    status: 'pending', // pending | running | completed | error
    createdAt: new Date().toISOString(),
    completedAt: null,
    accounts: accounts.map((a, idx) => ({
      idx,
      email: a.email,
      mode: a.mode,
      assigned: a.urls.length,
      success: 0,
      failure: 0,
      state: 'pending' // pending | running | done | error
    })),
    total: { assigned: accounts.reduce((s,a)=>s+a.urls.length,0), success:0, failure:0 },
    errors: [],
  };
}

app.get('/stage2/health', (req,res)=>res.json({ ok: true, time: new Date().toISOString() }));

// Fetch leads by filters helper
async function fetchCandidateLeads({ dateFrom, dateTo, tags }) {
  if (!dateFrom || !dateTo) throw new Error('dateFrom/dateTo required');
  const fromUtc = new Date(`${dateFrom}T00:00:00Z`).toISOString();
  const toUtc = new Date(`${dateTo}T23:59:59Z`).toISOString();
  let query = supabase
    .from('all_leads')
    .select('*')
    .eq('scrapped', false)
    .gte('created_at', fromUtc)
    .lte('created_at', toUtc);
  if (tags && tags.length) query = query.in('tag', tags);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Distribute leads evenly
function distribute(leads, accounts) {
  if (!leads.length) return accounts.map(a => ({ ...a, urls: [] }));
  const n = accounts.length;
  const base = Math.floor(leads.length / n);
  const rem = leads.length % n;
  const result = [];
  let idx = 0;
  for (let i=0;i<n;i++) {
    const take = base + (i < rem ? 1 : 0);
    result.push({ ...accounts[i], urls: leads.slice(idx, idx + take) });
    idx += take;
  }
  return result.filter(r => r.urls.length); // drop zero assignments
}

app.post('/stage2/scrape-multi', async (req,res) => {
  try {
    const { mode, accounts: acctPayload, n, dateFrom, dateTo, tags } = req.body || {};
    if (!mode || !['manual','stored'].includes(mode)) return res.status(400).json({ error: 'mode must be manual|stored' });
    if (!Array.isArray(acctPayload) || !acctPayload.length) return res.status(400).json({ error: 'accounts array required' });
    if (!n || n < 1) return res.status(400).json({ error: 'n (number of accounts) required' });
    if (acctPayload.length !== n) return res.status(400).json({ error: 'accounts length must equal n' });

    // Validate accounts & fetch passwords if stored mode
    let accounts = [];
    const seen = new Set();
    for (const row of acctPayload) {
      if (mode === 'manual') {
        const { email, password } = row;
        if (!email || !password) return res.status(400).json({ error: 'manual email/password required' });
        if (seen.has(email)) return res.status(400).json({ error: `duplicate email ${email}` });
        seen.add(email);
        accounts.push({ mode, email, password });
      } else {
        const { email, status } = row; // status for filtering retrieval if needed
        if (!email) return res.status(400).json({ error: 'stored email required' });
        if (seen.has(email)) return res.status(400).json({ error: `duplicate email ${email}` });
        seen.add(email);
        // fetch password
        const { data, error } = await supabase
          .from('accounts')
          .select('password')
          .eq('email_id', email)
          .single();
        if (error || !data) return res.status(400).json({ error: `password lookup failed for ${email}` });
        accounts.push({ mode, email, password: data.password });
      }
    }

    // Load candidate leads
    const leads = await fetchCandidateLeads({ dateFrom, dateTo, tags });
    if (!leads.length) return res.status(400).json({ error: 'No leads match filters (scrapped=false enforced)' });

    // Shuffle leads for fair distribution (optional)
    for (let i=leads.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [leads[i],leads[j]]=[leads[j],leads[i]]; }

  const urlList = leads.map(l=>l.linkedin_url).filter(Boolean);
  const enrichedAccounts = distribute(urlList, accounts);
  const job = createJob(enrichedAccounts);
    jobs.set(job.jobId, job);

    // Spawn workers
    job.status = 'running';
    enrichedAccounts.forEach((acct, idx) => {
      const workerPath = path.join(__dirname, 'worker-stage2.js');
      const child = fork(workerPath, [], { stdio: ['inherit','inherit','inherit','ipc'] });
      job.accounts[idx].state = 'running';
      child.send({ type: 'start', payload: {
        email: acct.email,
        password: acct.password,
        urls: acct.urls,
        options: { headless: false, writeJson: false, minutePacing: true, verbose: true }
      }});
      child.on('message', (msg) => {
        if (msg?.type === 'progress') {
          job.accounts[idx].success = msg.success;
          job.accounts[idx].failure = msg.failure;
          job.total.success = job.accounts.reduce((s,a)=>s+a.success,0);
          job.total.failure = job.accounts.reduce((s,a)=>s+a.failure,0);
        } else if (msg?.type === 'done') {
          job.accounts[idx].success = msg.success;
            job.accounts[idx].failure = msg.failure;
            job.accounts[idx].state = 'done';
            job.total.success = job.accounts.reduce((s,a)=>s+a.success,0);
            job.total.failure = job.accounts.reduce((s,a)=>s+a.failure,0);
            if (job.accounts.every(a=>a.state === 'done' || a.state === 'error')) {
              job.status = job.accounts.some(a=>a.state==='error') ? 'error' : 'completed';
              job.completedAt = new Date().toISOString();
            }
        } else if (msg?.type === 'error') {
          job.accounts[idx].state = 'error';
          job.accounts[idx].failure = job.accounts[idx].failure + 1;
          job.errors.push({ email: acct.email, error: msg.error });
          if (job.accounts.every(a=>a.state === 'done' || a.state === 'error')) {
            job.status = 'error';
            job.completedAt = new Date().toISOString();
          }
        }
      });
      child.on('exit', (code) => {
        if (job.accounts[idx].state === 'running') {
          job.accounts[idx].state = code === 0 ? 'done' : 'error';
          if (job.accounts.every(a=>a.state === 'done' || a.state === 'error')) {
            job.status = job.accounts.some(a=>a.state==='error') ? 'error' : 'completed';
            job.completedAt = new Date().toISOString();
          }
        }
      });
    });

    res.json({ jobId: job.jobId, accounts: job.accounts.length, totalAssigned: job.total.assigned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// New simpler batch endpoint: client already fetched + distributed urls.
app.post('/stage2/scrape-batch', async (req,res) => {
  try {
    const { jobs: jobList, options } = req.body || {};
    if (!Array.isArray(jobList) || !jobList.length) return res.status(400).json({ error: 'jobs array required' });
    // Validate and normalize
    const emails = new Set();
    const normalized = [];
    for (const j of jobList) {
      if (!j?.email || !j?.password) return res.status(400).json({ error: 'email/password required for each job' });
      if (!Array.isArray(j.urls) || !j.urls.length) return res.status(400).json({ error: `urls required for ${j.email}` });
      if (emails.has(j.email)) return res.status(400).json({ error: `duplicate email ${j.email}` });
      emails.add(j.email);
      // Deduplicate urls inside each job just in case
      const uniqUrls = Array.from(new Set(j.urls.filter(Boolean)));
      normalized.push({ email: j.email, password: j.password, urls: uniqUrls });
    }
    const totalAssigned = normalized.reduce((s,a)=>s+a.urls.length,0);
    if (!totalAssigned) return res.status(400).json({ error: 'No urls provided across jobs' });

    // Create job entry
    const job = {
      jobId: uuidv4(),
      status: 'running',
      createdAt: new Date().toISOString(),
      completedAt: null,
      accounts: normalized.map((a,i)=>({ idx:i, email:a.email, mode:'batch', assigned:a.urls.length, success:0, failure:0, state:'running' })),
      total: { assigned: totalAssigned, success:0, failure:0 },
      errors: []
    };
    jobs.set(job.jobId, job);

    normalized.forEach((acct, idx) => {
      const workerPath = path.join(__dirname, 'worker-stage2.js');
      const child = fork(workerPath, [], { stdio: ['inherit','inherit','inherit','ipc'] });
      child.send({ type: 'start-session', payload: {
        email: acct.email,
        password: acct.password,
        urls: acct.urls,
        options: {
          headless: options?.headless === false ? false : false,
            writeJson: false,
            minutePacing: options?.minutePacing === false ? false : true,
            verbose: false
        },
        jobId: job.jobId,
        accountIndex: idx
      }});
      child.on('message', (msg) => {
        if (msg?.type === 'progress') {
          job.accounts[idx].success = msg.success;
          job.accounts[idx].failure = msg.failure;
          job.total.success = job.accounts.reduce((s,a)=>s+a.success,0);
          job.total.failure = job.accounts.reduce((s,a)=>s+a.failure,0);
        } else if (msg?.type === 'done') {
          job.accounts[idx].success = msg.success;
          job.accounts[idx].failure = msg.failure;
          job.accounts[idx].state = 'done';
          job.total.success = job.accounts.reduce((s,a)=>s+a.success,0);
          job.total.failure = job.accounts.reduce((s,a)=>s+a.failure,0);
          if (job.accounts.every(a=>a.state==='done' || a.state==='error')) {
            job.status = job.accounts.some(a=>a.state==='error') ? 'error' : 'completed';
            job.completedAt = new Date().toISOString();
          }
        } else if (msg?.type === 'error') {
          job.accounts[idx].state = 'error';
          job.errors.push({ email: acct.email, error: msg.error });
          if (job.accounts.every(a=>a.state==='done' || a.state==='error')) {
            job.status = 'error';
            job.completedAt = new Date().toISOString();
          }
        }
      });
      child.on('exit', (code) => {
        if (job.accounts[idx].state === 'running') {
          job.accounts[idx].state = code === 0 ? 'done' : 'error';
          if (job.accounts.every(a=>a.state==='done' || a.state==='error')) {
            job.status = job.accounts.some(a=>a.state==='error') ? 'error' : 'completed';
            job.completedAt = new Date().toISOString();
          }
        }
      });
    });

    res.json({ jobId: job.jobId, jobs: job.accounts.length, totalAssigned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/stage2/jobs/:jobId', (req,res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

const PORT = process.env.STAGE2_PORT || 4002;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`[stage2] server listening on ${PORT}`));
}

export default app;
