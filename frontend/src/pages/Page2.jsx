import React, { useEffect, useState, useCallback, useRef } from 'react';
import '../styles/page2.css';
import { createClient } from '@supabase/supabase-js';

// Simple supabase client (public anon) – assumes env vars present in Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnon ? createClient(supabaseUrl, supabaseAnon) : null;

function FieldError({ msg }) { if (!msg) return null; return <div style={{ color: 'red', fontSize: 12 }}>{msg}</div>; }

export default function Stage1() {
  // Page2 now ONLY shows the dashboard (scraper tab removed)
  // Auth user (needs to be before any hook using userId)
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
  // Dashboard state
  const [dashDateFrom, setDashDateFrom] = useState(''); // yyyy-mm-dd
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashTags, setDashTags] = useState([]); // selected tags
  const [availableTags, setAvailableTags] = useState([]); // all distinct tags for user
  const NULL_TAG_LABEL = '(No Tag)';
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState(null);
  const [dashRows, setDashRows] = useState([]);
  const [dashTotal, setDashTotal] = useState(0);
  const [dashPage, setDashPage] = useState(1);
  const [dashPageSize, setDashPageSize] = useState(25);
  const dashSort = { column: 'created_at', direction: 'desc' }; // fixed for now
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const selectAllRef = useRef(null);
  const [dashScrapped, setDashScrapped] = useState('all'); // all | true | false

  // Helper: get last 7 days inclusive in IST
  function initLast7DaysIST() {
    const nowUtc = new Date();
    // Convert to IST offset (+5:30)
    const istOffsetMin = 330; // minutes
    const nowIst = new Date(nowUtc.getTime() + istOffsetMin * 60000);
    const end = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), 23, 59, 59));
    const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000); // last 7 days inclusive
    const toInput = (d) => {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    return { fromStr: toInput(start), toStr: toInput(end) };
  }

  // Initialize date range on first dashboard activation
  useEffect(() => {
    if (!dashDateFrom && !dashDateTo) {
      const { fromStr, toStr } = initLast7DaysIST();
      setDashDateFrom(fromStr);
      setDashDateTo(toStr);
    }
  }, [dashDateFrom, dashDateTo]);

  // Fetch distinct tags for this user (optionally filtered by date range once set)
  const loadTags = useCallback(async () => {
    if (!supabase || !userId) return;
    if (!dashDateFrom || !dashDateTo) return;
    try {
      const fromUtc = new Date(`${dashDateFrom}T00:00:00Z`); // treat as UTC midnight (approx to IST logic later)
      const toUtc = new Date(`${dashDateTo}T23:59:59Z`);
      // Query distinct tags
      let query = supabase
        .from('all_leads')
        .select('tag', { distinct: true })
        .eq('user_id', userId)
        .gte('created_at', fromUtc.toISOString())
        .lte('created_at', toUtc.toISOString());
      if (dashScrapped === 'true') query = query.eq('scrapped', true);
      else if (dashScrapped === 'false') query = query.eq('scrapped', false);
      const { data, error } = await query;
      if (error) throw error;
      // Deduplicate & normalize (trim) in case backend distinct isn't effective or tags vary by whitespace
      let sawNull = false;
      const tagSet = new Set();
      (data || []).forEach(r => {
        const raw = r.tag;
        if (raw == null) { sawNull = true; return; }
        const cleaned = String(raw).trim();
        if (!cleaned) { sawNull = true; return; }
        tagSet.add(cleaned);
      });
      const tags = Array.from(tagSet).sort((a,b)=>a.localeCompare(b));
      if (sawNull) tags.unshift(NULL_TAG_LABEL);
      setAvailableTags(tags);
    } catch (err) {
      console.error('Load tags error', err.message);
    }
  }, [dashDateFrom, dashDateTo, supabase, userId, dashScrapped]);

  useEffect(() => { loadTags(); }, [loadTags]);

  // Manage indeterminate state for Select All tags
  useEffect(() => {
    if (selectAllRef.current) {
      const all = availableTags.length;
      const sel = dashTags.length;
      selectAllRef.current.indeterminate = sel > 0 && sel < all;
    }
  }, [availableTags, dashTags]);

  // Fetch rows with filters
  const fetchDashboard = useCallback(async (opts={}) => {
    if (!supabase || !userId) return;
    if (!dashDateFrom || !dashDateTo) return;
    setDashLoading(true);
    setDashError(null);
    try {
      const page = opts.page || dashPage;
      const pageSize = opts.pageSize || dashPageSize;
      const fromUtc = new Date(`${dashDateFrom}T00:00:00Z`);
      const toUtc = new Date(`${dashDateTo}T23:59:59Z`);
      let query = supabase
        .from('all_leads')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .gte('created_at', fromUtc.toISOString())
        .lte('created_at', toUtc.toISOString());
      if (dashScrapped === 'true') query = query.eq('scrapped', true);
      else if (dashScrapped === 'false') query = query.eq('scrapped', false);
      if (dashTags.length) {
        const hasNull = dashTags.includes(NULL_TAG_LABEL);
        const real = dashTags.filter(t => t !== NULL_TAG_LABEL);
        if (hasNull && real.length) {
          // Build OR expression: tag.in.(...), tag.is.null, tag.eq. (empty string)
          const inList = real.map(t => `"${t.replace(/"/g,'\\"')}"`).join(',');
          query = query.or(`tag.in.(${inList}),tag.is.null,tag.eq.`);
        } else if (hasNull) {
          query = query.or('tag.is.null,tag.eq.');
        } else {
          query = query.in('tag', real);
        }
      }
      // Sorting
      query = query.order('created_at', { ascending: dashSort.direction !== 'desc' });
      // Range (pagination) - Supabase range is inclusive indexes
      const fromIdx = (page - 1) * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      query = query.range(fromIdx, toIdx);
      const { data, error, count } = await query;
      if (error) throw error;
      setDashRows(data || []);
      setDashTotal(count || 0);
      setDashPage(page);
      setDashPageSize(pageSize);
    } catch (err) {
      setDashError(err.message);
    } finally {
      setDashLoading(false);
    }
  }, [supabase, userId, dashDateFrom, dashDateTo, dashTags, dashPage, dashPageSize, dashSort.direction, dashScrapped]);

  function toIST(utcStr) {
    if (!utcStr) return '';
    const d = new Date(utcStr);
    // IST offset +5:30 = 330 minutes
    const ist = new Date(d.getTime() + 330 * 60000);
    const yyyy = ist.getUTCFullYear();
    const mm = String(ist.getUTCMonth()+1).padStart(2,'0');
    const dd = String(ist.getUTCDate()).padStart(2,'0');
    const HH = String(ist.getUTCHours()).padStart(2,'0');
    const MI = String(ist.getUTCMinutes()).padStart(2,'0');
    const SS = String(ist.getUTCSeconds()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS} IST`;
  }

  // CSV export (current filtered dataset all pages)
  async function exportCsv() {
    if (!supabase || !userId || !dashDateFrom || !dashDateTo) return;
    try {
      const fromUtc = new Date(`${dashDateFrom}T00:00:00Z`);
      const toUtc = new Date(`${dashDateTo}T23:59:59Z`);
      let query = supabase
        .from('all_leads')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', fromUtc.toISOString())
        .lte('created_at', toUtc.toISOString());
      if (dashScrapped === 'true') query = query.eq('scrapped', true);
      else if (dashScrapped === 'false') query = query.eq('scrapped', false);
      if (dashTags.length) {
        const hasNull = dashTags.includes(NULL_TAG_LABEL);
        const real = dashTags.filter(t => t !== NULL_TAG_LABEL);
        if (hasNull && real.length) {
          const inList = real.map(t => `"${t.replace(/"/g,'\\"')}"`).join(',');
          query = query.or(`tag.in.(${inList}),tag.is.null,tag.eq.`);
        } else if (hasNull) {
          query = query.or('tag.is.null,tag.eq.');
        } else {
          query = query.in('tag', real);
        }
      }
      query = query.order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const headers = ['lead_id','linkedin_url','bio','tag','created_at'];
      const csvLines = [headers.join(',')];
      rows.forEach(r => {
        const line = headers.map(h => {
          const val = r[h] == null ? '' : String(r[h]).replace(/"/g,'""');
          return `"${val}"`;
        }).join(',');
        csvLines.push(line);
      });
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_${dashDateFrom}_${dashDateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDashError(err.message);
    }
  }

  const [emailMode, setEmailMode] = useState('manual'); // manual | stored
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');

  const [accountStatus, setAccountStatus] = useState('active');
  const [accounts, setAccounts] = useState([]); // raw rows including password
  const [accountEmail, setAccountEmail] = useState('');
  const [storedPassword, setStoredPassword] = useState('');

  const [keyword, setKeyword] = useState('');
  const [searchUrl, setSearchUrl] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  const [tag, setTag] = useState('');

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Fetch accounts by status
  const loadAccounts = useCallback(async (status) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('accounts')
      .select('email_id,password,status')
      .eq('status', status);
    if (error) {
      console.error('Fetch accounts error', error.message);
      setAccounts([]);
    } else {
      setAccounts(data || []);
    }
  }, []);

  useEffect(() => { if (emailMode === 'stored') loadAccounts(accountStatus); }, [emailMode, accountStatus, loadAccounts]);

  useEffect(() => {
    if (emailMode === 'stored') {
      const row = accounts.find(a => a.email_id === accountEmail);
      setStoredPassword(row?.password || '');
    } else {
      setStoredPassword('');
    }
  }, [accountEmail, accounts, emailMode]);

  function validate() {
    const e = {};
    if (!userId) e.userId = 'User not authenticated';
    if (emailMode === 'manual') {
      if (!manualEmail) e.manualEmail = 'Email required';
      if (!manualPassword) e.manualPassword = 'Password required';
    } else {
      if (!accountEmail) e.accountEmail = 'Select an account email';
      if (!storedPassword) e.storedPassword = 'Stored password missing';
    }
    if (keyword && searchUrl) e.search = 'Provide either keyword or search URL, not both';
    if (!keyword && !searchUrl) e.search = 'Provide a keyword or a search URL';
    if (durationSec < 0) e.duration = 'Duration must be >= 0';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setResult(null);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    try {
      const payload = {
        emailMode,
        email: emailMode === 'manual' ? manualEmail : undefined,
        password: emailMode === 'manual' ? manualPassword : storedPassword,
        accountStatus: emailMode === 'stored' ? accountStatus : undefined,
        accountEmail: emailMode === 'stored' ? accountEmail : undefined,
        keyword: keyword || undefined,
        searchUrl: searchUrl || undefined,
        durationSec: Number(durationSec) || 0,
        tag: tag || 'not_defined',
        userId,
      };
      // Unified server support: prefer explicit stage1 var, then unified base, finally legacy port 4001
      const stage1Base = window.dreamforceBridge 
        ? (await window.dreamforceBridge.getBackendUrl('scraper')) || 'http://localhost:4000'
        : (import.meta.env.VITE_SCRAPE_API || import.meta.env.VITE_BACKEND_BASE || 'http://localhost:4000');
  const res = await fetch(`${stage1Base.replace(/\/$/, '')}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      setResult(json);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="scraper-page container">
      <h2>Lead Collection Dashboard</h2>
      <p className="muted small" style={{marginTop:4}}>Scraper functionality has been removed. This page now only shows collected leads.</p>
        <div className="dashboard-wrapper mt-sm">
          <h2>Dashboard</h2>
          <p className="muted small">Date From: {dashDateFrom || '...'} Date To: {dashDateTo || '...'} Rows: {dashRows.length} / Total: {dashTotal}</p>
          {dashError && <div className="error-text">{dashError}</div>}
          <div className="filter-bar mt-sm">
            <div className="filter-item">
              <label className="lbl sm">From<br/>
                <input type="date" value={dashDateFrom} onChange={e=>setDashDateFrom(e.target.value)} />
              </label>
            </div>
            <div className="filter-item">
              <label className="lbl sm">To<br/>
                <input type="date" value={dashDateTo} onChange={e=>setDashDateTo(e.target.value)} />
              </label>
            </div>
            <div className="filter-item">
              <label className="lbl sm">Scrapped<br/>
                <select value={dashScrapped} onChange={e=>setDashScrapped(e.target.value)}>
                  <option value="all">All</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </label>
            </div>
            <div className="filter-item tag-filter">
              <label className="lbl sm">Tags<br/>
                <div className="tag-select-trigger">
                  <button type="button" onClick={()=>setTagDropdownOpen(o=>!o)} className="btn outline full-width left-align">
                    {dashTags.length ? `${dashTags.length} selected` : 'Select tags'}
                  </button>
                </div>
              </label>
              {tagDropdownOpen && (
                <div className="tag-dropdown">
                  <div className="tag-dropdown-header">
                    <label className="lbl sm flex-row gap-xs align-center">
                      <input type="checkbox"
                        ref={selectAllRef}
                        checked={availableTags.length>0 && dashTags.length === availableTags.length}
                        onChange={(e)=>{
                          if (e.target.checked) setDashTags([...availableTags]); else setDashTags([]);
                        }}
                      /> Select All
                    </label>
                  </div>
                  <div className="tag-options">
                    {availableTags.map(tagVal => (
                      <label key={tagVal} className="tag-option">
                        <input type="checkbox" checked={dashTags.includes(tagVal)} onChange={(e)=>{
                          if (e.target.checked) setDashTags(prev=>[...prev, tagVal]);
                          else setDashTags(prev=>prev.filter(t=>t!==tagVal));
                        }} /> <span>{tagVal}</span>
                      </label>
                    ))}
                    {!availableTags.length && <div className="empty small">No tags</div>}
                  </div>
                  <div className="dropdown-actions">
                    <button type="button" className="btn xs" onClick={()=>setTagDropdownOpen(false)}>Close</button>
                  </div>
                </div>
              )}
            </div>
            <div className="filter-item">
              <button type="button" className="btn primary" onClick={()=>{ fetchDashboard({ page:1 }); loadTags(); }} disabled={dashLoading || !dashDateFrom || !dashDateTo}>{dashLoading ? 'Loading...' : 'Apply'}</button>
            </div>
            <div className="filter-item">
              <button type="button" className="btn" onClick={exportCsv} disabled={dashLoading || !dashTotal}>Export CSV</button>
            </div>
          </div>
          <div className="table-wrapper mt-md">
            <div className="table-meta small">
              <span className="strong total-highlight" aria-label="Total rows for current filter">Total: {dashTotal}</span>
              <span>Page {dashPage} ({dashRows.length} rows)</span>
            </div>
            <table className="data-table small">
              <thead>
                <tr>
                  <th>lead_id</th>
                  <th>linkedin_url</th>
                  <th>bio</th>
                  <th>tag</th>
                  <th>created_at (IST)</th>
                </tr>
              </thead>
              <tbody>
                {dashRows.map(r => (
                  <tr key={r.lead_id}>
                    <td>{r.lead_id}</td>
                    <td className="truncate" title={r.linkedin_url}><a href={r.linkedin_url} target="_blank" rel="noreferrer">link</a></td>
                    <td className="truncate" title={r.bio}>{r.bio}</td>
                    <td>{r.tag}</td>
                    <td>{toIST(r.created_at)}</td>
                  </tr>
                ))}
                {!dashRows.length && !dashLoading && (
                  <tr><td colSpan={5} className="empty">No data</td></tr>
                )}
                {dashLoading && (
                  <tr><td colSpan={5} className="loading">Loading...</td></tr>
                )}
              </tbody>
            </table>
            <div className="pagination-row">
              <button type="button" className="btn xs" disabled={dashPage<=1 || dashLoading} onClick={()=>fetchDashboard({ page: dashPage-1 })}>Prev</button>
              <span className="small">Page {dashPage} / {Math.max(1, Math.ceil(dashTotal / dashPageSize))}</span>
              <button type="button" className="btn xs" disabled={dashPage >= Math.ceil(dashTotal / dashPageSize) || dashLoading} onClick={()=>fetchDashboard({ page: dashPage+1 })}>Next</button>
              <select className="page-size" value={dashPageSize} disabled={dashLoading} onChange={e=>{ setDashPageSize(Number(e.target.value)); fetchDashboard({ page:1, pageSize: Number(e.target.value) }); }}>
                {[10,25,50,100].map(sz => <option key={sz} value={sz}>{sz} / page</option>)}
              </select>
              <span className="small muted">Total: {dashTotal}</span>
            </div>
          </div>
        </div>
    </div>
  );
}
