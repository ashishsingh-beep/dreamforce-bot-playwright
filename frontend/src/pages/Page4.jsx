// Example: Page4.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import '../styles/page4.css';
import { supabase } from '../services/supabaseClient';

// Page4: LLM Processing Orchestrator
// Parallel batches -> each batch: api_key + shared texts + chunk of leads (send_to_llm=false)

const NULL_TAG_LABEL = '(No Tag)';

export default function Page4(){
  const [activeTab,setActiveTab]=useState('scraper'); // 'scraper' | 'dashboard'
  // Configuration
  const [requestCount,setRequestCount]=useState(1);
  const [apiKeys,setApiKeys]=useState(['']);
  const [wildnetData,setWildnetData]=useState('');
  const [scoringCriteria,setScoringCriteria]=useState('');
  const [messagePrompt,setMessagePrompt]=useState('');

  // Filters (reuse Stage2 dashboard style minus send_to_llm (forced false))
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [tagOptions,setTagOptions]=useState([]);
  const [selectedTags,setSelectedTags]=useState([]);
  const [locationFilter,setLocationFilter]=useState('');
  const [tagDropdownOpen,setTagDropdownOpen]=useState(false);
  const selectAllRef=useRef(null);
  const [loadingTags,setLoadingTags]=useState(false);

  // Leads
  const [loadingLeads,setLoadingLeads]=useState(false);
  const [leads,setLeads]=useState([]); // raw joined rows
  const [leadsError,setLeadsError]=useState(null);

  // Results state per batch
  const [batches,setBatches]=useState([]); // {idx,status:'waiting'|'running'|'done'|'error', count, results, error, duration}
  const [submitting,setSubmitting]=useState(false);

  // Init last 7 days
  useEffect(()=>{
    if(!dateFrom && !dateTo){
      const now=new Date();
      const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),23,59,59));
      const start=new Date(end.getTime()-6*24*60*60*1000);
      const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      setDateFrom(fmt(start)); setDateTo(fmt(end));
    }
  },[dateFrom,dateTo]);

  // Adjust apiKeys array on requestCount change
  useEffect(()=>{
    setApiKeys(prev=>{const arr=[...prev]; if(requestCount>arr.length){while(arr.length<requestCount) arr.push('');} else if(requestCount<arr.length){arr.length=requestCount;} return arr;});
    setBatches(prev=>{const arr=[]; for(let i=0;i<requestCount;i++){arr.push(prev[i]||{idx:i,status:'waiting',count:0,results:[],error:null,duration:null});} return arr;});
  },[requestCount]);

  // Load tag options (distinct) from all_leads (removed send_to_llm constraint to ensure always returns something if tags exist)
  const loadTags=useCallback(async()=>{
    if(!supabase || !dateFrom || !dateTo) return; setLoadingTags(true);
    try{
      const fromIso=new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toIso=new Date(`${dateTo}T23:59:59Z`).toISOString();
      const {data,error}=await supabase
        .from('all_leads')
        .select('tag')
        .gte('created_at', fromIso)
        .lte('created_at', toIso);
      if(error) throw error;
      let sawNull=false; const setUnique=new Set();
      (data||[]).forEach(r=>{ if(r.tag==null){sawNull=true;return;} const t=String(r.tag).trim(); if(!t){sawNull=true;return;} setUnique.add(t); });
      const arr=Array.from(setUnique).sort((a,b)=>a.localeCompare(b)); if(sawNull) arr.unshift(NULL_TAG_LABEL);
      setTagOptions(arr); setSelectedTags(prev=>prev.filter(t=>arr.includes(t)));
    }catch(e){/* log silently */}
    finally{ setLoadingTags(false);} },[supabase,dateFrom,dateTo]);
  useEffect(()=>{ loadTags(); },[loadTags]);

  useEffect(()=>{ if(selectAllRef.current){ const all=tagOptions.length; const sel=selectedTags.length; selectAllRef.current.indeterminate= sel>0 && sel<all; } },[tagOptions,selectedTags]);

  // Fetch leads (joined) via RPC or manual join: use RPC fetch_stage2_dashboard enforcing sent_to_llm=false
  async function loadLeads(){
    if(!supabase || !dateFrom || !dateTo){return;}
    setLoadingLeads(true); setLeadsError(null);
    try{
      const rpcPayload={
        _date_from: dateFrom,
        _date_to: dateTo,
        _tags: selectedTags.filter(t=>t!==NULL_TAG_LABEL).length? selectedTags.filter(t=>t!==NULL_TAG_LABEL): null,
        _sent_to_llm: false,
        _location: locationFilter? locationFilter.trim(): null,
        _page:1,
        _page_size: 10000 // large cap; adjust if needed
      };
      const {data,error}=await supabase.rpc('fetch_stage2_dashboard', rpcPayload);
      if(error) throw error;
      const row = data && data[0];
      const rows = Array.isArray(row?.rows)? row.rows: [];
      // If null-tag chosen include rows whose tag is null or empty (RPC currently filters equality; fallback fetch if needed -> we approximate by client filtering if user selected NULL)
      let filtered = rows;
      if(selectedTags.includes(NULL_TAG_LABEL)){
        filtered = rows.filter(r=> (r.tag==null || String(r.tag).trim()==='') || !selectedTags.filter(t=>t!==NULL_TAG_LABEL).length || selectedTags.filter(t=>t!==NULL_TAG_LABEL).includes(r.tag));
      } else if(selectedTags.length){
        filtered = rows.filter(r=> selectedTags.includes(r.tag));
      }
      setLeads(filtered);
    }catch(e){ setLeadsError(e.message); }
    finally{ setLoadingLeads(false);} }

  // Distribution of leads across requestCount
  const distributed = useMemo(()=>{
    if(!leads.length || requestCount<1) return [];
    const per = Math.floor(leads.length / requestCount);
    const rem = leads.length % requestCount;
    const out=[]; let idx=0;
    for(let i=0;i<requestCount;i++){ const take = per + (i<rem?1:0); out.push(leads.slice(idx, idx+take)); idx+=take; }
    return out;
  },[leads,requestCount]);

  // Validation before run
  function validate(){
    const issues=[];
    if(!requestCount || requestCount<1) issues.push('Request count must be >=1');
    apiKeys.forEach((k,i)=>{ if(!k) issues.push(`API key #${i+1} empty`); });
    if(!wildnetData.trim()) issues.push('Wildnet data empty');
    if(!scoringCriteria.trim()) issues.push('Scoring criteria empty');
    if(!messagePrompt.trim()) issues.push('Message prompt empty');
    if(!leads.length) issues.push('No leads loaded');
    return issues;
  }

  async function runBatches(){
    const errs=validate(); if(errs.length){ alert(errs.join('\n')); return; }
    setSubmitting(true);
    setBatches(prev=> prev.map((b,i)=>({...b,status:'waiting',results:[],error:null,duration:null,count:distributed[i]?.length||0})) );
    const base = (import.meta.env.VITE_LLM_API || 'http://localhost:8000');
    await Promise.allSettled(distributed.map(async(chunk,i)=>{
      setBatches(cur=>cur.map(b=> b.idx===i? {...b,status:'running'}:b));
      const body={
        api_key: apiKeys[i],
        wildnet_data: wildnetData,
        scoring_criteria_and_icp: scoringCriteria,
        message_prompt: messagePrompt,
        leads: chunk
      };
      const started=performance.now();
      try{
        const res = await fetch(`${base.replace(/\/$/,'')}/process-leads`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!res.ok){ const errTxt= await res.text(); throw new Error(errTxt || res.statusText); }
        const json = await res.json();
        // Enrich returned results with tag from original chunk (lookup by lead_id)
        const tagMap = new Map(chunk.map(c=> [c.lead_id, c.tag]));
        const enriched = (json.results||[]).map(r=> ({...r, tag: tagMap.get(r.lead_id) || r.tag || null }));
        setBatches(cur=>cur.map(b=> b.idx===i? {...b,status:'done',results:enriched,duration:json.duration_sec}:b));
      }catch(e){
        setBatches(cur=>cur.map(b=> b.idx===i? {...b,status:'error',error:e.message,duration: ((performance.now()-started)/1000).toFixed(2)}:b));
      }
    }));
    setSubmitting(false);
  }

  // Aggregate results
  const flatResults = useMemo(()=> batches.flatMap(b=>b.results||[]),[batches]);

  function exportCsv(){
    if(!flatResults.length) return;
    const headers=['lead_id','tag','name','linkedin_url','location','score','should_contact','subject','message'];
    const lines=[headers.join(',')];
    flatResults.forEach(r=>{ lines.push(headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(',')); });
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='llm_results.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="page4-wrapper">
      <div className="tabs-row" style={{display:'flex',gap:8,marginBottom:'0.75rem'}}>
        <button type="button" className={`btn tab-btn ${activeTab==='scraper'?'primary':''}`} onClick={()=>setActiveTab('scraper')}>Scraper</button>
        <button type="button" className={`btn tab-btn ${activeTab==='dashboard'?'primary':''}`} onClick={()=>setActiveTab('dashboard')}>Dashboard</button>
      </div>

      {activeTab==='scraper' && <ScraperTab
        requestCount={requestCount}
        setRequestCount={setRequestCount}
        apiKeys={apiKeys}
        setApiKeys={setApiKeys}
        wildnetData={wildnetData}
        setWildnetData={setWildnetData}
        scoringCriteria={scoringCriteria}
        setScoringCriteria={setScoringCriteria}
        messagePrompt={messagePrompt}
        setMessagePrompt={setMessagePrompt}
        dateFrom={dateFrom}
        dateTo={dateTo}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        tagOptions={tagOptions}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        tagDropdownOpen={tagDropdownOpen}
        setTagDropdownOpen={setTagDropdownOpen}
        selectAllRef={selectAllRef}
        loadingTags={loadingTags}
        loadTags={loadTags}
        locationFilter={locationFilter}
        setLocationFilter={setLocationFilter}
        loadingLeads={loadingLeads}
        leads={leads}
        leadsError={leadsError}
        loadLeads={loadLeads}
        batches={batches}
        setBatches={setBatches}
        submitting={submitting}
        runBatches={runBatches}
        distributed={distributed}
        flatResults={flatResults}
        exportCsv={exportCsv}
      />}
      {activeTab==='dashboard' && <Stage3Dashboard />}
    </div>
  );
}

// ---------------- Scraper Tab (original content) ----------------
function ScraperTab(props){
  const {requestCount,setRequestCount,apiKeys,setApiKeys,wildnetData,setWildnetData,scoringCriteria,setScoringCriteria,messagePrompt,setMessagePrompt,dateFrom,dateTo,setDateFrom,setDateTo,tagOptions,selectedTags,setSelectedTags,tagDropdownOpen,setTagDropdownOpen,selectAllRef,loadingTags,loadTags,locationFilter,setLocationFilter,loadingLeads,leads,leadsError,loadLeads,batches,setBatches,submitting,runBatches,distributed,flatResults,exportCsv} = props;

  return (
    <>
      <h2>LLM Lead Processing</h2>
      <p className="small muted">Configure parallel Gemini scoring & message generation batches.</p>

      <section className="card">
        <h3 className="section-title">1. Requests & API Keys</h3>
        <div className="flex-row wrap">
          <label style={{minWidth:140}}>Number of Requests<br/>
            <input type="number" min={1} value={requestCount} onChange={e=>setRequestCount(Math.max(1,Number(e.target.value)||1))} />
          </label>
          <div className="grid-keys" style={{flex:1}}>
            {apiKeys.map((k,i)=> (
              <label key={i}>API Key #{i+1}<br/>
                <input type="text" value={k} onChange={e=> setApiKeys(prev=> prev.map((v,pi)=> pi===i? e.target.value : v))} placeholder="Gemini API Key" />
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="card" style={{marginTop:'1rem'}}>
        <h3 className="section-title">2. Shared Text Inputs</h3>
        <div className="flex-row wrap">
          <div style={{flex:1,minWidth:260}}>
            <label>Wildnet Data<br/>
              <textarea value={wildnetData} onChange={e=>setWildnetData(e.target.value)} placeholder="Paste Wildnet company/context data" />
            </label>
          </div>
          <div style={{flex:1,minWidth:260}}>
            <label>Scoring Criteria & ICP<br/>
              <textarea value={scoringCriteria} onChange={e=>setScoringCriteria(e.target.value)} placeholder="Define scoring criteria & ICP" />
            </label>
          </div>
          <div style={{flex:1,minWidth:260}}>
            <label>Message Prompt / Instructions<br/>
              <textarea value={messagePrompt} onChange={e=>setMessagePrompt(e.target.value)} placeholder="Provide messaging style / personalization instructions" />
            </label>
          </div>
        </div>
      </section>

      <section className="card" style={{marginTop:'1rem'}}>
        <h3 className="section-title">3. Load Leads (send_to_llm = false)</h3>
        <div className="flex-row wrap">
          <label>Date From<br/><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></label>
          <label>Date To<br/><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} /></label>
          <label>Location<br/><input type="text" placeholder="substring" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)} /></label>
          <div className="tag-filter">
            <label>Tags<br/>
              <button type="button" className="btn outline" onClick={()=>setTagDropdownOpen(o=>!o)}>
                {selectedTags.length? `${selectedTags.length} selected` : (tagOptions.length? 'Select Tags' : 'No Tags Found (Click to Add Manual)')}
              </button>
            </label>
            {tagDropdownOpen && (
              <div className="tag-dropdown" style={{zIndex:120}}>
                <div className="tag-dropdown-header">
                  {tagOptions.length>0 ? (
                    <label><input type="checkbox" ref={selectAllRef} checked={tagOptions.length>0 && selectedTags.length===tagOptions.length} onChange={(e)=>{ if(e.target.checked) setSelectedTags([...tagOptions]); else setSelectedTags([]); }} /> Select All</label>
                  ) : (
                    <div className="small muted">No existing tags this range</div>
                  )}
                </div>
                <div className="tag-options">
                  {tagOptions.map(t=> (
                    <label key={t} className="tag-option">
                      <input type="checkbox" checked={selectedTags.includes(t)} onChange={(e)=>{ if(e.target.checked) setSelectedTags(prev=>[...prev,t]); else setSelectedTags(prev=>prev.filter(x=>x!==t)); }} /> {t}
                    </label>
                  ))}
                  {!tagOptions.length && (
                    <ManualTagAdder onAdd={(val)=>{ if(!val) return; setTagOptions(prev=> prev.includes(val)? prev : [...prev,val]); setSelectedTags(prev=> prev.includes(val)? prev : [...prev,val]); }} />
                  )}
                </div>
                <div className="dropdown-actions"><button className="btn xs" type="button" onClick={()=>setTagDropdownOpen(false)}>Close</button></div>
              </div>
            )}
          </div>
          <button type="button" className="btn primary self-end" disabled={loadingLeads} onClick={loadLeads}>{loadingLeads? 'Loading...' : 'Load Leads'}</button>
        </div>
        {loadingTags && <div className="small muted" style={{marginTop:4}}>Loading tags…</div>}
        {leadsError && <div className="small" style={{color:'crimson',marginTop:4}}>{leadsError}</div>}
        <div className="small split-info">Loaded: {leads.length} | Requests: {requestCount} | Avg/Chunk: {requestCount? Math.round(leads.length/requestCount):0}</div>
        <div className="table-wrap" style={{marginTop:'.75rem'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>lead_id</th>
                <th>tag</th>
                <th>name</th>
                <th>title</th>
                <th>location</th>
                <th>company_name</th>
                <th>experience</th>
                <th>skills</th>
                <th>bio</th>
                <th>profile</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0,200).map((r,i)=> (
                <tr key={r.lead_id+':'+i}>
                  <td>{i+1}</td>
                  <td>{r.lead_id}</td>
                  <td>{r.tag}</td>
                  <td className="truncate" title={r.name}>{r.name}</td>
                  <td className="truncate" title={r.title}>{r.title}</td>
                  <td className="truncate" title={r.location}>{r.location}</td>
                  <td className="truncate" title={r.company_name}>{r.company_name}</td>
                  <td className="truncate" title={r.experience}>{r.experience}</td>
                  <td className="truncate" title={r.skills}>{r.skills}</td>
                  <td className="truncate" title={r.bio}>{r.bio}</td>
                  <td>{r.profile_url && <a href={r.profile_url} target="_blank" rel="noreferrer">link</a>}</td>
                </tr>
              ))}
              {!leads.length && !loadingLeads && <tr><td colSpan={11} className="empty">No data</td></tr>}
              {loadingLeads && <tr><td colSpan={11}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="small muted" style={{marginTop:4}}>Showing first 200 rows for preview.</div>
      </section>

      <section className="card" style={{marginTop:'1rem'}}>
        <h3 className="section-title">4. Distribution Preview</h3>
        <div className="status-grid">
          {distributed.map((chunk,i)=> (
            <div key={i} className="status-card">
              <div className="flex-row" style={{justifyContent:'space-between'}}>
                <strong>Batch #{i+1}</strong>
                <span className={`badge ${batches[i]?.status||'waiting'}`}>{batches[i]?.status||'waiting'}</span>
              </div>
              <div className="small">Leads: {chunk.length}</div>
              <div className="small muted">API Key: {apiKeys[i]? apiKeys[i].slice(0,4)+'…' : '—'}</div>
              {batches[i]?.duration && <div className="small">Time: {batches[i].duration}s</div>}
              {batches[i]?.error && <div className="small" style={{color:'crimson'}}>Err: {batches[i].error}</div>}
              {batches[i]?.results?.length>0 && <div className="small" style={{color:'#065f46'}}>Results: {batches[i].results.length}</div>}
            </div>
          ))}
          {!distributed.length && <div className="small muted">No distribution yet.</div>}
        </div>
        <div className="actions-row" style={{marginTop:'.75rem'}}>
          <button type="button" className="btn primary" disabled={submitting || !distributed.length} onClick={runBatches}>{submitting? 'Running…' : 'Run All Batches'}</button>
          <button type="button" className="btn outline" disabled={!flatResults.length} onClick={exportCsv}>Export CSV</button>
        </div>
      </section>

      {flatResults.length>0 && (
        <section className="card" style={{marginTop:'1rem'}}>
          <h3 className="section-title">5. Aggregated Results ({flatResults.length})</h3>
          <AggregatedResultsTable results={flatResults} />
        </section>
      )}
    </>
  );
}

// ---------------- Stage3 Dashboard Tab ----------------
function Stage3Dashboard(){
  const [dateFrom,setDateFrom]=React.useState('');
  const [dateTo,setDateTo]=React.useState('');
  const [loading,setLoading]=React.useState(false);
  const [rows,setRows]=React.useState([]);
  const [error,setError]=React.useState(null);
  const [tagOptions,setTagOptions]=React.useState([]);
  const [selectedTags,setSelectedTags]=React.useState([]);
  const [tagOpen,setTagOpen]=React.useState(false);
  const selectAllRef=React.useRef(null);
  const [shouldOnly,setShouldOnly]=React.useState(false);
  const [scoreOp,setScoreOp]=React.useState('>=');
  const [scoreVal,setScoreVal]=React.useState('');
  const [locationSub,setLocationSub]=React.useState('');
  const [sortDir,setSortDir]=React.useState('desc');
  const [page,setPage]=React.useState(1);
  const pageSize=200;
  const supabaseClient = supabase;

  // init last 14 days
  React.useEffect(()=>{
    if(!dateFrom && !dateTo){
      const now=new Date();
      const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),23,59,59));
      const start=new Date(end.getTime()-13*24*60*60*1000);
      const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      setDateFrom(fmt(start)); setDateTo(fmt(end));
    }
  },[dateFrom,dateTo]);

  // load distinct tags by joining llm_response -> all_leads (llm_response itself has no tag column)
  const loadTags=React.useCallback(async()=>{
    if(!supabaseClient || !dateFrom || !dateTo) return;
    try {
      const fromIso=new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toIso=new Date(`${dateTo}T23:59:59Z`).toISOString();
      // Step 1: fetch lead_ids in date window from llm_response
      const { data: lrIds, error: lrErr } = await supabaseClient
        .from('llm_response')
        .select('lead_id')
        .gte('created_at', fromIso)
        .lte('created_at', toIso);
      if(lrErr) throw lrErr;
      const leadIds = Array.from(new Set((lrIds||[]).map(r=>r.lead_id).filter(Boolean)));
      if(!leadIds.length){ setTagOptions([]); return; }
      // Chunk to avoid URL length issues (Supabase in() limit)
      const chunkSize = 900;
      const tagsSet = new Set();
      for(let i=0;i<leadIds.length;i+=chunkSize){
        const slice = leadIds.slice(i,i+chunkSize);
        const { data: tagRows, error: tagErr } = await supabaseClient
          .from('all_leads')
          .select('tag')
          .in('lead_id', slice);
        if(tagErr) throw tagErr;
        (tagRows||[]).forEach(r=>{ if(r.tag!=null){ const t=String(r.tag).trim(); if(t) tagsSet.add(t); }});
      }
      setTagOptions(Array.from(tagsSet).sort((a,b)=>a.localeCompare(b)));
    } catch(e){ /* swallow */ }
  },[supabaseClient,dateFrom,dateTo]);
  React.useEffect(()=>{ loadTags(); },[loadTags]);

  React.useEffect(()=>{
    if(selectAllRef.current){ const all=tagOptions.length; const sel=selectedTags.length; selectAllRef.current.indeterminate = sel>0 && sel<all; }
  },[tagOptions,selectedTags]);

  async function fetchData(){
    if(!supabaseClient || !dateFrom || !dateTo) return;
    setLoading(true); setError(null);
    try{
      // Build RPC payload
      const payload={
        _date_from: dateFrom,
        _date_to: dateTo,
        _tags: selectedTags.length? selectedTags : null,
        _should_contact_only: shouldOnly,
        _score_op: scoreVal? scoreOp : null,
        _score_value: scoreVal? Number(scoreVal): null,
        _location_substr: locationSub? locationSub.trim(): null,
        _sort_dir: sortDir,
        _page: page,
        _page_size: pageSize
      };
      const { data, error } = await supabaseClient.rpc('fetch_stage3_dashboard', payload);
      if(error) throw error;
      const root = data && data[0];
      const r = Array.isArray(root?.rows)? root.rows : [];
      setRows(r);
    }catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  }

  React.useEffect(()=>{ fetchData(); },[dateFrom,dateTo,selectedTags,shouldOnly,scoreOp,scoreVal,locationSub,sortDir,page]);

  function exportCsv(){
    if(!rows.length) return;
    const headers=['created_at','lead_id','tag','name','title','company_name','location','score','should_contact','subject','message'];
    const lines=[headers.join(',')];
    rows.forEach(r=>{ lines.push(headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(',')); });
    const blob=new Blob([lines.join('\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='stage3_dashboard.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2>Stage3 Dashboard</h2>
      <p className="small muted">View processed LLM scoring & messaging results.</p>
      <section className="card">
        <h3 className="section-title">Filters</h3>
        <div className="flex-row wrap filter-row" style={{gap:'0.9rem',alignItems:'flex-start'}}>
          <label>Date From<br/><input type="date" value={dateFrom} onChange={e=>{setPage(1); setDateFrom(e.target.value);} }/></label>
          <label>Date To<br/><input type="date" value={dateTo} onChange={e=>{setPage(1); setDateTo(e.target.value);} }/></label>
          <div className="tag-filter">
            <label>Tags
              <button type="button" style={{marginTop:'.55rem'}} className="btn outline" onClick={()=>setTagOpen(o=>!o)}>{selectedTags.length? `${selectedTags.length} selected` : 'Select Tags'}</button>
            </label>
            {tagOpen && (
              <div className="tag-dropdown" style={{zIndex:130}}>
                <div className="tag-dropdown-header">
                  {tagOptions.length>0 && <label><input type="checkbox" ref={selectAllRef} checked={tagOptions.length>0 && selectedTags.length===tagOptions.length} onChange={(e)=>{ if(e.target.checked) setSelectedTags([...tagOptions]); else setSelectedTags([]); }} /> Select All</label>}
                </div>
                <div className="tag-options">
                  {tagOptions.map(t=> (
                    <label key={t} className="tag-option">
                      <input type="checkbox" checked={selectedTags.includes(t)} onChange={(e)=>{ if(e.target.checked) setSelectedTags(prev=>[...prev,t]); else setSelectedTags(prev=>prev.filter(x=>x!==t)); }} /> {t}
                    </label>
                  ))}
                  {!tagOptions.length && <div className="empty small">No tags in range</div>}
                </div>
                <div className="dropdown-actions"><button className="btn xs" type="button" onClick={()=>setTagOpen(false)}>Close</button></div>
              </div>
            )}
          </div>
          <label className="should-contact-wrapper">Should Contact
            <div className="inline-checkbox">
              <input type="checkbox" checked={shouldOnly} onChange={e=>{setPage(1); setShouldOnly(e.target.checked);} } />
            </div>
          </label>
          <label>Score Filter<br/>
            <div style={{display:'flex',gap:4}}>
              <select value={scoreOp} onChange={e=>{setScoreOp(e.target.value); setPage(1);}}>
                {['>','>=','=','<=','<'].map(op=> <option key={op} value={op}>{op}</option>)}
              </select>
              <input type="number" placeholder="value" value={scoreVal} onChange={e=>{setScoreVal(e.target.value); setPage(1);}} style={{width:90}} />
            </div>
          </label>
          <label>Location<br/><input type="text" value={locationSub} placeholder="substring" onChange={e=>{setLocationSub(e.target.value); setPage(1);} } /></label>
          <label>Sort<br/>
            <select value={sortDir} onChange={e=>{setSortDir(e.target.value);}}>
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
          <div className="self-end" style={{display:'flex',gap:6}}>
            <button type="button" className="btn primary" disabled={loading} onClick={()=>{setPage(1); fetchData();}}>{loading? 'Loading…':'Refresh'}</button>
            <button type="button" className="btn outline" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>
          </div>
        </div>
        {error && <div className="small" style={{color:'crimson',marginTop:6}}>{error}</div>}
        <div className="small muted" style={{marginTop:6}}>Rows: {rows.length} (Page {page})</div>
        <div className="table-wrap" style={{marginTop:'0.75rem'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Created</th>
                <th>Lead ID</th>
                <th>Tag</th>
                <th>Name</th>
                <th>Title</th>
                <th>Company</th>
                <th>Location</th>
                <th>Score</th>
                <th>Should Contact</th>
                <th>Subject</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=> (
                <tr key={r.lead_id+':dash:'+i}>
                  <td>{i+1}</td>
                  <td className="small" title={r.created_at}>{r.created_at?.slice(0,19).replace('T',' ')}</td>
                  <td className="truncate" title={r.lead_id}><a href={r.linkedin_url} target="_blank" rel="noreferrer">{r.lead_id?.slice(0,10)}…</a></td>
                  <td className="truncate" title={r.tag}>{r.tag}</td>
                  <td className="truncate" title={r.name}>{r.name}</td>
                  <td className="truncate" title={r.title}>{r.title}</td>
                  <td className="truncate" title={r.company_name}>{r.company_name}</td>
                  <td className="truncate" title={r.location}>{r.location}</td>
                  <td style={{textAlign:'center'}}>{r.score}</td>
                  <td style={{textAlign:'center'}}>{r.should_contact}</td>
                  <td className="truncate" title={r.subject}>{r.subject}</td>
                  <td className="truncate" title={r.message}>{r.message==='ineligible'? '—' : r.message?.slice(0,60)}</td>
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={12} className="empty">No data</td></tr>}
              {loading && <tr><td colSpan={12}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="small muted" style={{marginTop:4}}>Pagination (client): page size {pageSize}. Add true server pagination via RPC if needed.</div>
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <button className="btn xs" disabled={page===1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
          <button className="btn xs" disabled={rows.length<pageSize} onClick={()=>setPage(p=>p+1)}>Next</button>
        </div>
      </section>
    </div>
  );
}

// ---------------- Aggregated Results Table Component ----------------
function AggregatedResultsTable({ results }){
  const [showAll,setShowAll]=React.useState(false);
  const MAX = 500; // cap render for perf
  const display = showAll? results.slice(0,MAX): results.slice(0,100);
  const truncated = results.length>display.length;

  function cell(txt,limit=60){
    if(txt==null) return '';
    const s=String(txt);
    if(s.length<=limit) return s;
    return s.slice(0,limit)+'…';
  }

  return (
    <div>
      <div className="table-wrap" style={{maxHeight:'420px'}}>
        <table className="data-table results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Lead ID</th>
              <th>Tag</th>
              <th>Name</th>
              <th>Location</th>
              <th>Score</th>
              <th>Should Contact</th>
              <th>Subject</th>
              <th>Message (Reasoning Hover)</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r,i)=> (
              <tr key={r.lead_id+':res:'+i}>
                <td>{i+1}</td>
                <td className="truncate" title={r.lead_id}><a href={r.linkedin_url} target="_blank" rel="noreferrer">{cell(r.lead_id,18)}</a></td>
                <td className="truncate" title={r.tag}>{cell(r.tag,18)}</td>
                <td className="truncate" title={r.name}>{cell(r.name,22)}</td>
                <td className="truncate" title={r.location}>{cell(r.location,28)}</td>
                <td style={{textAlign:'center'}}>{r.score}</td>
                <td style={{textAlign:'center'}}>{r.should_contact}</td>
                <td className="truncate" title={r.subject}>{cell(r.subject,30)}</td>
                <td className="truncate" title={`Reasoning: ${r.response}\nMessage: ${r.message}`}>{cell(r.message==='ineligible'? r.response : r.message, 80)}</td>
              </tr>
            ))}
            {!display.length && <tr><td colSpan={9} className="empty">No results</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="small muted" style={{marginTop:4}}>
        Showing {display.length} {showAll? '(max capped)': 'of first 100'} result rows{truncated && !showAll? ' – truncated for performance' : ''}.
      </div>
      {truncated && (
        <button type="button" className="btn xs" style={{marginTop:6}} onClick={()=>setShowAll(s=>!s)}>
          {showAll? 'Show First 100' : `Show Up To ${MAX}`}
        </button>
      )}
      <details style={{marginTop:'0.75rem'}}>
        <summary className="small">Raw JSON (first 50)</summary>
        <div className="result-pre" style={{maxHeight:300}}>{JSON.stringify(results.slice(0,50),null,2)}</div>
      </details>
    </div>
  );
}

// Small inline component to manually add a tag when no tags exist
function ManualTagAdder({ onAdd }){
  const [val,setVal]=React.useState('');
  return (
    <div className="manual-tag-adder" style={{padding:'0.5rem 0'}}>
      <div className="small" style={{marginBottom:4}}>Add a tag manually:</div>
      <div style={{display:'flex',gap:4}}>
        <input type="text" value={val} placeholder="Enter tag" onChange={e=>setVal(e.target.value)} style={{flex:1}} />
        <button type="button" className="btn xs" onClick={()=>{ const trimmed=val.trim(); if(trimmed){ onAdd(trimmed); setVal(''); } }}>Add</button>
      </div>
    </div>
  );
}
