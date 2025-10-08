import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/page3.css';
import { supabase } from '../services/supabaseClient';

// Clean Stage2 Dashboard only (scraper logic removed)
export default function Stage2(){
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [tags,setTags]=useState([]);
  const [availableTags,setAvailableTags]=useState([]);
  const selectAllRef=useRef(null);
  const [sentToLlm,setSentToLlm]=useState('all');
  const [location,setLocation]=useState('');
  const [rows,setRows]=useState([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(25);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [tagOpen,setTagOpen]=useState(false);
  const MAX_EXPORT=5000;

  // init last 7 days
  useEffect(()=>{
    if(!from || !to){
      const now=new Date();
      const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),23,59,59));
      const start=new Date(end.getTime()-6*24*60*60*1000);
      const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      setFrom(fmt(start)); setTo(fmt(end));
    }
  },[from,to]);

  const loadTags=useCallback(async()=>{
    if(!supabase || !from || !to) return;
    try{
      const { data, error } = await supabase
        .from('all_leads')
        .select('tag')
        .gte('created_at', new Date(`${from}T00:00:00Z`).toISOString())
        .lte('created_at', new Date(`${to}T23:59:59Z`).toISOString());
      if(error) throw error;
      const setU=new Set(); (data||[]).forEach(r=>{ const t=(r.tag||'').trim(); if(t) setU.add(t); });
      const arr=Array.from(setU).sort((a,b)=>a.localeCompare(b));
      setAvailableTags(arr);
      setTags(prev=>prev.filter(t=>arr.includes(t)));
    }catch(e){ /*silent*/ }
  },[from,to]);
  useEffect(()=>{ loadTags(); },[loadTags]);

  useEffect(()=>{ if(selectAllRef.current){ const all=availableTags.length; const sel=tags.length; selectAllRef.current.indeterminate = sel>0 && sel<all; } },[availableTags,tags]);

  const fetchData=useCallback(async(opts={})=>{
    if(!supabase || !from || !to) return;
    setLoading(true); setError(null);
    const nextPage=opts.page || page;
    const nextPageSize=opts.pageSize || pageSize;
    try{
      const { data, error } = await supabase.rpc('fetch_stage2_dashboard', {
        _date_from: from,
        _date_to: to,
        _tags: tags.length? tags : null,
        _sent_to_llm: sentToLlm==='all'? null : (sentToLlm==='true'),
        _location: location? location.trim(): null,
        _page: nextPage,
        _page_size: nextPageSize
      });
      if(error) throw error;
      const root=data && data[0];
      setTotal(root?.total_count || 0);
      setRows(Array.isArray(root?.rows)? root.rows: []);
      setPage(nextPage); setPageSize(nextPageSize);
    }catch(e){ setError(e.message); } finally { setLoading(false); }
  },[from,to,tags,sentToLlm,location,page,pageSize]);
  useEffect(()=>{ fetchData({ page:1 }); },[fetchData]);

  function exportCsv(){
    if(!rows.length) return;
    const headers=['lead_id','tag','name','title','location','company_name','experience','skills','bio','profile_url','company_page_url','send_to_llm','lead_created_at'];
    const lines=[headers.join(',')];
    rows.forEach(r=>{ lines.push(headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(',')); });
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`stage2_dashboard_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="page3">
      <div className="card mt-md">
        <h2>Stage2 Dashboard</h2>
        <div className="flex-row gap-sm wrap mt-sm">
          <label>Date From<br/><input type="date" value={from} onChange={e=>{ setFrom(e.target.value); setPage(1); }} /></label>
          <label>Date To<br/><input type="date" value={to} onChange={e=>{ setTo(e.target.value); setPage(1); }} /></label>
          <div className="tag-filter">
            <label>Tags<br/>
              <button type="button" className="btn outline" disabled={!availableTags.length && !tags.length} onClick={()=>setTagOpen(o=>!o)}>
                {tags.length? `${tags.length} selected` : 'Select Tags'}
              </button>
            </label>
            {tagOpen && (
              <div className="tag-dropdown" style={{zIndex:120}}>
                <div className="tag-dropdown-header">
                  <label><input type="checkbox" ref={selectAllRef} checked={availableTags.length>0 && tags.length===availableTags.length} onChange={(e)=>{ if(e.target.checked) setTags([...availableTags]); else setTags([]); }} /> Select All</label>
                </div>
                <div className="tag-options">
                  {availableTags.map(t=> (
                    <label key={t} className="tag-option">
                      <input type="checkbox" checked={tags.includes(t)} onChange={(e)=>{ if(e.target.checked) setTags(prev=>[...prev,t]); else setTags(prev=>prev.filter(x=>x!==t)); }} /> {t}
                    </label>
                  ))}
                  {!availableTags.length && <div className="empty small">No tags</div>}
                </div>
                <div className="dropdown-actions"><button className="btn xs" type="button" onClick={()=>setTagOpen(false)}>Close</button></div>
              </div>
            )}
          </div>
          <label>send_to_llm<br/>
            <select value={sentToLlm} onChange={e=>{ setSentToLlm(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </label>
          <label>Location<br/><input type="text" value={location} onChange={e=>{ setLocation(e.target.value); setPage(1); }} /></label>
          <button type="button" className="btn primary self-end" disabled={loading || !from || !to} onClick={()=>fetchData({ page:1 })}>{loading? 'Loading...' : 'Apply'}</button>
          <button type="button" className="btn self-end" disabled={loading || !total} onClick={exportCsv}>Export CSV</button>
        </div>
        {error && <div className="error-text small mt-sm">{error}</div>}
        <div className="small mt-xs">Rows: {rows.length} / Total: {total} {total>MAX_EXPORT && <span style={{color:'#b45309'}}> (export capped at {MAX_EXPORT})</span>}</div>
        <div className="mt-sm" style={{overflowX:'auto'}}>
          <table className="data-table small">
            <thead>
              <tr>
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
                <th>company</th>
                <th>send_to_llm</th>
                <th>lead_created_at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=> (
                <tr key={r.lead_id}>
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
                  <td>{r.company_page_url && <a href={r.company_page_url} target="_blank" rel="noreferrer">site</a>}</td>
                  <td>{String(r.send_to_llm)}</td>
                  <td title={r.lead_created_at}>{r.lead_created_at?.slice(0,19).replace('T',' ')}</td>
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={13} className="empty">No data</td></tr>}
              {loading && <tr><td colSpan={13} className="loading">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination-row mt-sm">
          <button type="button" className="btn xs" disabled={page<=1 || loading} onClick={()=>fetchData({ page: page-1 })}>Prev</button>
          <span className="small">Page {page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button type="button" className="btn xs" disabled={page >= Math.ceil(total / pageSize) || loading} onClick={()=>fetchData({ page: page+1 })}>Next</button>
          <select className="page-size" value={pageSize} disabled={loading} onChange={e=>{ fetchData({ page:1, pageSize: Number(e.target.value) }); }}>
            {[10,25,50,100].map(sz=> <option key={sz} value={sz}>{sz} / page</option>)}
          </select>
          <span className="small muted">Total: {total}</span>
        </div>
      </div>
    </div>
  );
}
