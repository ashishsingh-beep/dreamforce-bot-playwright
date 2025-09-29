import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/page3.css';

// Supabase client from env (anon)
import { supabase } from '../services/supabaseClient';

function FieldError({ msg }) { if (!msg) return null; return <div style={{ color: 'red', fontSize: 12 }}>{msg}</div>; }

export default function Page3() {
  // Tabs: scraper first, dashboard placeholder
  const [activeTab, setActiveTab] = useState('scraper');
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    let mounted = true;
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (mounted) setUserId(data?.session?.user?.id || null);
      });
    }
    return () => { mounted = false; };
  }, []);

  // Mode & accounts
  const [mode, setMode] = useState('manual'); // manual | stored
  const [accountCount, setAccountCount] = useState(1);
  const MAX_PREVIEW = 5;

  // Stored accounts source lists by status
  const [statusFilter, setStatusFilter] = useState('active');
  const [storedAccounts, setStoredAccounts] = useState([]); // fetched rows
  const loadStoredAccounts = useCallback(async (status) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('accounts')
      .select('email_id,password,status')
      .eq('status', status);
    if (!error) setStoredAccounts(data || []);
  }, []);
  useEffect(() => { if (mode === 'stored') loadStoredAccounts(statusFilter); }, [mode, statusFilter, loadStoredAccounts]);

  // Dynamic credential rows state
  const [manualCreds, setManualCreds] = useState([{ email: '', password: '' }]);
  const [storedSelections, setStoredSelections] = useState([{ email: '' }]);
  useEffect(() => {
    if (mode === 'manual') {
      setManualCreds(prev => {
        const arr = [...prev];
        if (accountCount > arr.length) {
          while (arr.length < accountCount) arr.push({ email: '', password: '' });
        } else if (accountCount < arr.length) {
          arr.length = accountCount;
        }
        return arr;
      });
    } else {
      setStoredSelections(prev => {
        const arr = [...prev];
        if (accountCount > arr.length) {
          while (arr.length < accountCount) arr.push({ email: '' });
        } else if (accountCount < arr.length) {
          arr.length = accountCount;
        }
        return arr;
      });
    }
  }, [accountCount, mode]);

  // Leads filtering (client side) similar to Page2 but force scrapped=false
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  // Map canonicalTag -> Set(original variants) so filtering covers all variations (case/whitespace)
  const [tagGroups, setTagGroups] = useState({});
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const selectAllRef = useRef(null);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadRows, setLeadRows] = useState([]);
  const [leadsError, setLeadsError] = useState(null);
  const [leadLimit, setLeadLimit] = useState(0); // 0 = no cap

  function initLast7() {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23,59,59));
    const start = new Date(end.getTime() - 6*24*60*60*1000);
    const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    return { from: fmt(start), to: fmt(end) };
  }
  useEffect(() => {
    if (!dateFrom && !dateTo) {
      const { from, to } = initLast7();
      setDateFrom(from); setDateTo(to);
    }
  }, [dateFrom, dateTo]);

  // Load tags (distinct)
  const loadTags = useCallback(async () => {
    if (!supabase || !dateFrom || !dateTo) return;
    try {
      const fromUtc = new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toUtc = new Date(`${dateTo}T23:59:59Z`).toISOString();
      // Pull all tag values (might have duplicates / case / spacing differences)
      const { data, error } = await supabase
        .from('all_leads')
        .select('tag')
        .eq('scrapped', false)
        .gte('created_at', fromUtc)
        .lte('created_at', toUtc);
      if (error) throw error;
      const groups = {};
      (data || []).forEach(r => {
        const raw = (r.tag || '').trim();
        if (!raw) return;
        const canonical = raw.toLowerCase().replace(/\s+/g,' ');
        if (!groups[canonical]) groups[canonical] = new Set();
        groups[canonical].add(raw.replace(/\s+/g,' ')); // collapse internal whitespace for display consistency
      });
      // Choose first variant for display; keep mapping in state
      const uniqueDisplay = Object.values(groups).map(set => Array.from(set)[0]);
      uniqueDisplay.sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' }));
      setAvailableTags(uniqueDisplay);
      setTagGroups(groups);
      // If previously selected tags had duplicates, re-sync to filtered set
      setSelectedTags(prev => prev.filter(t => uniqueDisplay.includes(t)));
    } catch (e) { /* silent */ }
  }, [dateFrom, dateTo]);
  useEffect(() => { if (activeTab==='scraper') loadTags(); }, [activeTab, loadTags]);

  useEffect(() => {
    if (selectAllRef.current) {
      const all = availableTags.length; const sel = selectedTags.length;
      selectAllRef.current.indeterminate = sel > 0 && sel < all;
    }
  }, [availableTags, selectedTags]);

  async function fetchLeads() {
    if (!supabase || !dateFrom || !dateTo) return;
    setLoadingLeads(true); setLeadsError(null);
    try {
      const fromUtc = new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toUtc = new Date(`${dateTo}T23:59:59Z`).toISOString();
      let q = supabase
        .from('all_leads')
        .select('linkedin_url,created_at,tag')
        .eq('scrapped', false)
        .gte('created_at', fromUtc)
        .lte('created_at', toUtc);
      if (selectedTags.length) {
        // Expand selected display tags into all original variants captured in tagGroups for inclusive filtering
        const expanded = selectedTags.flatMap(t => {
          const canonical = t.toLowerCase().replace(/\s+/g,' ');
          const variants = tagGroups[canonical];
          return variants ? Array.from(variants) : [t];
        });
        // Deduplicate expanded list
        const uniqExpanded = Array.from(new Set(expanded));
        q = q.in('tag', uniqExpanded);
      }
      // Apply limit if provided (>0). Supabase JS: .limit(n)
      if (leadLimit && Number(leadLimit) > 0) {
        q = q.order('created_at', { ascending: false }).limit(Number(leadLimit));
      } else {
        q = q.order('created_at', { ascending: false });
      }
      const { data, error } = await q;
      if (error) throw error;
      setLeadRows(data || []);
    } catch (e) {
      setLeadsError(e.message);
    } finally { setLoadingLeads(false); }
  }

  // Distribution (top/mid/bottom) after we have leads and accountCount
  const distributed = React.useMemo(() => {
    if (!leadRows.length || accountCount < 1) return [];
    const per = Math.floor(leadRows.length / accountCount);
    const rem = leadRows.length % accountCount;
    const buckets = []; let idx=0;
    for (let i=0;i<accountCount;i++) {
      const take = per + (i < rem ? 1 : 0);
      buckets.push(leadRows.slice(idx, idx+take).map(r=>r.linkedin_url));
      idx += take;
    }
    return buckets;
  }, [leadRows, accountCount]);

  // Validation
  const [errors, setErrors] = useState({});
  function validate() {
    const e = {};
    if (!userId) e.user = 'Not authenticated';
    if (accountCount < 1) e.accounts = 'At least one account';
    if (!leadRows.length) e.leads = 'Load leads first';
    if (mode === 'manual') {
      manualCreds.forEach((c,i)=>{ if (!c.email) e[`mEmail${i}`]='Email required'; if (!c.password) e[`mPass${i}`]='Password required'; });
      const dup = new Set();
      manualCreds.forEach(c => { if (c.email && dup.has(c.email)) e.dup='Duplicate emails'; dup.add(c.email); });
    } else {
      storedSelections.forEach((c,i)=>{ if (!c.email) e[`sEmail${i}`]='Select email'; });
      const dup = new Set();
      storedSelections.forEach(c => { if (c.email && dup.has(c.email)) e.dup='Duplicate emails'; dup.add(c.email); });
    }
    return e;
  }

  // Submit (batch call)
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [pollTimer, setPollTimer] = useState(null);
  const scrapeApi = import.meta.env.VITE_STAGE2_API || 'http://localhost:4002';
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);
  const [purgeCount, setPurgeCount] = useState(null);
  const [purgedThisSession, setPurgedThisSession] = useState(false);
  const [lastPurgeTs, setLastPurgeTs] = useState(null);

  async function purgeNonExecutiveWildnet() {
    if (!supabase) return;
    if (!confirm('This will permanently delete matching leads. Continue?')) return;
    setPurging(true); setPurgeResult(null); setPurgeCount(null);
    try {
      // Attempt to call a SQL function if it exists (preferred). If not, fall back to a single raw fetch using PostgREST /rpc.
      // Recommended: create a SQL function (on backend) named purge_non_exec_wildnet() that runs the provided DELETE and returns integer count.
      // Here we try calling it; if 404 we fallback to direct PostgREST /rest/v1 with ?delete filter combination approximation (less precise).
      const funcName = 'purge_non_exec_wildnet';
      let count = null;
      const { data, error, status } = await supabase.rpc(funcName);
      if (error && status !== 404) throw error;
      if (!error && typeof data !== 'undefined') {
        count = data; // function should RETURN integer
        setPurgeResult({ ok: true, count, via: 'function' });
        setPurgeCount(count);
        setPurgedThisSession(true);
        setLastPurgeTs(new Date().toISOString());
      } else {
        // Fallback: raw SQL via fetch (requires service key BEWARE). We avoid exposing service key here; so show instruction instead.
        setPurgeResult({ ok: false, message: 'Create SQL function purge_non_exec_wildnet() to enable one-click purge. Function not found.' });
      }
    } catch (e) {
      setPurgeResult({ ok: false, message: e.message });
    } finally { setPurging(false); }
  }

  async function startBatch() {
    const v = validate(); setErrors(v); if (Object.keys(v).length) return;
    // Build jobs payload
    const jobs = (mode === 'manual' ? manualCreds : storedSelections).map((row, idx) => ({
      email: row.email,
      password: mode === 'manual' ? row.password : (storedAccounts.find(a=>a.email_id===row.email)?.password || ''),
      urls: distributed[idx] || []
    })).filter(j => j.urls.length); // skip empty
    if (!jobs.length) { setErrors({ leads: 'No urls to assign' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${scrapeApi}/stage2/scrape-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobs, options: { headless: false } })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setJobId(json.jobId); setJobStatus(null);
    } catch (e) { setErrors({ submit: e.message }); } finally { setSubmitting(false); }
  }

  // Polling
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${scrapeApi}/stage2/jobs/${jobId}`);
        const j = await r.json();
        if (r.ok) {
          setJobStatus(j);
          if (j.status === 'completed' || j.status === 'error') {
            clearInterval(t);
          }
        }
      } catch (_) { /* ignore */ }
    }, 4000);
    setPollTimer(t);
    return () => clearInterval(t);
  }, [jobId, scrapeApi]);

  // Cleanup on tab change
  useEffect(() => { return () => { if (pollTimer) clearInterval(pollTimer); }; }, [pollTimer]);

  return (
    <div className="page3">
      <div className="tabs-row">
        <button type="button" className={`tab-btn ${activeTab==='scraper'?'active':''}`} onClick={()=>setActiveTab('scraper')}>Scraper</button>
        <button type="button" className={`tab-btn ${activeTab==='dashboard'?'active':''}`} onClick={()=>setActiveTab('dashboard')}>Dashboard</button>
      </div>
      {activeTab==='scraper' && (
        <div className="scraper-pane">
          <div className="purge-banner">
            <div className="pb-left">
              <div className="pb-title">Pre-Scrape Data Purge Required</div>
              <div className="pb-text">Run this purge once per session to remove leads you do NOT want to spend scrape cycles on. It deletes:
                <ul className="pb-list">
                  <li>Leads already working at Wildnet (company contains "wildnet")</li>
                  <li>Leads in non–decision-making / non–leadership roles (e.g. excludes Founder, CEO, Co-Founder, Director, Head, VP, President)</li>
                </ul>
                Batch scraping is disabled until you purge.</div>
              <div className="pb-meta">
                {purgedThisSession ? (
                  <span className="ok">Purged{purgeCount!=null?` ${purgeCount} rows`:''} at {lastPurgeTs && new Date(lastPurgeTs).toLocaleString()}</span>
                ) : <span className="warn">Not purged yet</span>}
              </div>
            </div>
            <div className="pb-action">
              <button type="button" className="btn purge-btn" disabled={purging} onClick={purgeNonExecutiveWildnet}>{purging? 'Purging...' : (purgedThisSession ? 'Purge Again' : 'Run Purge Now')}</button>
            </div>
          </div>
          <h2>Stage2 Multi-Account Scraper</h2>

          <section className="card">
            <h3>Accounts</h3>
            <div className="flex-row gap-sm">
              <label>Mode<br/>
                <select value={mode} onChange={e=>{ setMode(e.target.value); setAccountCount(1); }}>
                  <option value="manual">Manual</option>
                  <option value="stored">Stored</option>
                </select>
              </label>
              <label>Number of Accounts<br/>
                <input type="number" min={1} value={accountCount} onChange={e=>setAccountCount(Math.max(1,Number(e.target.value)||1))} />
              </label>
              {mode==='stored' && (
                <label>Status Filter<br/>
                  <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                    <option value="active">active</option>
                    <option value="temp">temp</option>
                    <option value="flagged">flagged</option>
                  </select>
                </label>
              )}
            </div>
            <div className="accounts-rows mt-sm">
              {mode==='manual' && manualCreds.map((row,i)=>(
                <div key={i} className="acct-row">
                  <span className="idx">#{i+1}</span>
                  <input className="w-200" placeholder="email" value={row.email} onChange={e=>{
                    const v=[...manualCreds]; v[i]={...v[i], email:e.target.value}; setManualCreds(v);
                  }} />
                  <input className="w-160" placeholder="password" type="password" value={row.password} onChange={e=>{
                    const v=[...manualCreds]; v[i]={...v[i], password:e.target.value}; setManualCreds(v);
                  }} />
                  <FieldError msg={errors[`mEmail${i}`] || errors[`mPass${i}`]} />
                </div>
              ))}
              {mode==='stored' && storedSelections.map((row,i)=>(
                <div key={i} className="acct-row">
                  <span className="idx">#{i+1}</span>
                  <select className="w-220" value={row.email} onChange={e=>{
                    const v=[...storedSelections]; v[i]={ email:e.target.value }; setStoredSelections(v);
                  }}>
                    <option value="">-- select account --</option>
                    {storedAccounts.map(a=> <option key={a.email_id} value={a.email_id}>{a.email_id}</option>)}
                  </select>
                  <FieldError msg={errors[`sEmail${i}`]} />
                </div>
              ))}
              {errors.dup && <FieldError msg={errors.dup} />}
            </div>
          </section>

          <section className="card mt-md">
            <h3>Filters (Unscrapped Leads)</h3>
            <div className="flex-row gap-sm wrap">
              <label>Date From<br/><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></label>
              <label>Date To<br/><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} /></label>
              <div className="tag-filter">
                <label>Tags<br/>
                  <button type="button" className="btn outline" onClick={()=>setTagDropdownOpen(o=>!o)}>
                    {selectedTags.length ? `${selectedTags.length} selected` : 'Select Tags'}
                  </button>
                </label>
                {tagDropdownOpen && (
                  <div className="tag-dropdown">
                    <div className="tag-dropdown-header">
                      <label><input type="checkbox" ref={selectAllRef} checked={availableTags.length>0 && selectedTags.length===availableTags.length} onChange={(e)=>{
                        if (e.target.checked) setSelectedTags([...availableTags]); else setSelectedTags([]);
                      }} /> Select All</label>
                    </div>
                    <div className="tag-options">
                      {availableTags.map(t => (
                        <label key={t} className="tag-option">
                          <input type="checkbox" checked={selectedTags.includes(t)} onChange={(e)=>{
                            if (e.target.checked) setSelectedTags(prev=>[...prev,t]); else setSelectedTags(prev=>prev.filter(x=>x!==t));
                          }} /> {t}
                        </label>
                      ))}
                      {!availableTags.length && <div className="empty small">No tags</div>}
                    </div>
                    <div className="dropdown-actions"><button className="btn xs" type="button" onClick={()=>setTagDropdownOpen(false)}>Close</button></div>
                  </div>
                )}
              </div>
              <label>Number of Leads<br/>
                <input type="number" min={0} placeholder="0 = all" value={leadLimit} onChange={e=>setLeadLimit(e.target.value)} />
              </label>
              <button className="btn primary self-end" disabled={loadingLeads} onClick={fetchLeads}>{loadingLeads ? 'Loading...' : 'Load Leads'}</button>
            </div>
            {leadsError && <div className="error-text small mt-sm">{leadsError}</div>}
            <div className="small mt-xs">Loaded: {leadRows.length} leads</div>
            <FieldError msg={errors.leads} />
          </section>

          <section className="card mt-md">
            <h3>Distribution Preview</h3>
            {!leadRows.length && <div className="empty small">No leads loaded</div>}
            {leadRows.length > 0 && (
              <table className="data-table small">
                <thead><tr><th>#</th><th>Email / Slot</th><th>Assigned URLs</th><th>Preview (first {MAX_PREVIEW})</th></tr></thead>
                <tbody>
                  {distributed.map((urls, i) => (
                    <tr key={i}>
                      <td>{i+1}</td>
                      <td>{mode==='manual' ? manualCreds[i]?.email || '(empty)' : storedSelections[i]?.email || '(select)'} </td>
                      <td>{urls.length}</td>
                      <td className="truncate" title={urls.slice(0,MAX_PREVIEW).join('\n')}>{urls.slice(0,MAX_PREVIEW).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="small mt-xs muted">Top to bottom split (deterministic). No duplicate distribution within this batch.</div>
          </section>

            <section className="card mt-md">
              <h3>Run</h3>
              <div className="flex-row gap-sm wrap">
                <button className="btn primary" disabled={submitting || !purgedThisSession} onClick={startBatch}>{submitting ? 'Starting...' : (!purgedThisSession ? 'Purge Required' : 'Start Batch Scrape')}</button>
                {errors.submit && <FieldError msg={errors.submit} />}
                <button type="button" className="btn outline" disabled={purging} onClick={purgeNonExecutiveWildnet}>{purging ? 'Purging...' : 'Purge Again'}</button>
              </div>
              {jobId && <div className="small mt-sm">Job: {jobId}</div>}
              {purgeResult && (
                <div className="small mt-sm" style={{color: purgeResult.ok ? '#0d766e' : 'crimson'}}>
                  {purgeResult.ok ? `Purge complete${purgeResult.count!=null ? `: ${purgeResult.count} rows deleted` : ''} (via ${purgeResult.via})` : `Purge failed: ${purgeResult.message}`}
                </div>
              )}
            </section>

            {jobStatus && (
              <section className="card mt-md">
                <h3>Job Status: {jobStatus.status}</h3>
                <div className="small mt-xs">Total: {jobStatus.total.assigned} | Success: {jobStatus.total.success} | Failure: {jobStatus.total.failure}</div>
                <table className="data-table small mt-sm">
                  <thead><tr><th>#</th><th>Email</th><th>Assigned</th><th>Success</th><th>Failure</th><th>State</th></tr></thead>
                  <tbody>
                    {jobStatus.accounts.map(a => (
                      <tr key={a.idx}>
                        <td>{a.idx+1}</td>
                        <td>{a.email}</td>
                        <td>{a.assigned}</td>
                        <td>{a.success}</td>
                        <td>{a.failure}</td>
                        <td>{a.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {jobStatus.errors?.length ? <pre className="code-block mt-sm">{JSON.stringify(jobStatus.errors,null,2)}</pre> : null}
              </section>
            )}
        {purging && (
          <div className="overlay-spinner" role="alert" aria-live="assertive">
            <div className="spinner" />
            <div className="spinner-text">Purging… Please wait</div>
          </div>
        )}
        </div>
      )}
      {activeTab==='dashboard' && (
        <div className="card mt-md"><h2>Dashboard (Coming Soon)</h2><p className="small muted">Stage2 dashboard not implemented yet.</p></div>
      )}
    </div>
  );
}
