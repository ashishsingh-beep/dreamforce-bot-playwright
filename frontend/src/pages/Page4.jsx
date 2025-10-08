// Example: Page4.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/page4.css';
import { supabase } from '../services/supabaseClient';

// Simplified Page4: only Stage3 Dashboard (scraper/batch processing removed)
export default function Stage3(){
  return (
    <div className="page4-wrapper">
      <Stage3Dashboard />
    </div>
  );
}

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
// (Removed AggregatedResultsTable and batch processing related components)
