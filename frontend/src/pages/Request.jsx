import React, { useEffect, useState, useCallback } from 'react';
import '../styles/page1.css';
import { supabase } from '../services/supabaseClient';
import { Link } from 'react-router-dom';

/*
  Request Dashboard
  - Form to create a new request row in `requests` table
  Columns (as per screenshot): request_id (uuid, default), created_at (timestamptz default), keywords (text), request_by (uuid), request_by_name (text), is_fulfilled (bool default false)
  - We collect keywords & request_by_name from user.
  - request_by = current user id
  - is_fulfilled = false (implicit; do not send if default)
  - Show list of user's past requests (latest first) with basic status display & refresh.
  - Provide realtime subscription (optional future step) guarded behind presence of channel support.
*/

export default function Request() {
  const [userId, setUserId] = useState(null);
  const [keywords, setKeywords] = useState(''); // space separated only
  const [requestByName, setRequestByName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formMsg, setFormMsg] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);

  // Acquire current user id
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) return;
      setUserId(data?.user?.id || null);
    });
    return () => { mounted = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from('requests')
        .select('request_id, created_at, keywords, request_by_name, is_fulfilled')
        .eq('request_by', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      setHistoryError(e.message || 'Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Optional: realtime updates for this user's requests
  useEffect(() => {
    if (!userId) return;
    // Attempt to create a channel only if realtime is available in this client build
    try {
      const channel = supabase.channel(`requests-user-${userId}`);
      channel
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'requests',
          filter: `request_by=eq.${userId}`
        }, (payload) => {
          // Simple strategy: reload history (small volume expected)
            loadHistory();
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') setRealtimeEnabled(true);
        });
      return () => { supabase.removeChannel(channel); };
    } catch {
      // ignore if realtime not supported
    }
  }, [userId, loadHistory]);

  const resetMessages = () => { setFormError(null); setFormMsg(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    if (!userId) { setFormError('You must be logged in.'); return; }
  if (!keywords.trim()) { setFormError('Keywords required.'); return; }
  if (/[,\n]/.test(keywords)) { setFormError('Remove commas / line breaks. Use single spaces.'); return; }
  if (/\s{2,}/.test(keywords.trim())) { setFormError('Collapse multiple spaces between keywords.'); return; }
    if (!requestByName.trim()) { setFormError('Your name is required.'); return; }

    setSubmitting(true);
    try {
      const row = {
        keywords: keywords.trim(),
        request_by: userId,
        request_by_name: requestByName.trim(),
        // is_fulfilled left as default (false)
      };
      const { data, error } = await supabase.from('requests').insert([row]).select().maybeSingle();
      if (error) throw error;
      setFormMsg('Request submitted.');
      setKeywords('');
      // Keep name sticky so user doesn't retype each time
      // Refresh history (or rely on realtime)
      if (!realtimeEnabled) loadHistory();
    } catch (e) {
      setFormError(e.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
      setTimeout(() => { setFormMsg(null); setFormError(null); }, 4000);
    }
  };

  return (
    <div className="page1">
      <div className="hero">
        <div className="card" style={{ maxWidth: 780 }}>
          <h2>Request Dashboard</h2>
          <p className="muted" style={{ marginTop: 4 }}>Create new processing / scraping requests and view your history.</p>
          <div className="small" style={{marginTop:8,background:'#f1f5f9',padding:'8px 10px',border:'1px solid var(--border-color)',borderRadius:6}}>
            <strong>Keyword format:</strong> If there are multiple keywords, enter them separated by a single space. Do NOT use commas or line breaks.
          </div>
          {/* Accounts needed note moved to bottom */}

          {/* Form Section */}
          <form onSubmit={handleSubmit} className="request-form" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>Keywords<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="text"
                value={keywords}
                disabled={submitting}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="salesforce ai architect"
                inputMode="text"
                pattern="^[^,\n]+$"
                title="Space-separated keywords only. No commas or line breaks."
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>Your Name<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="text"
                value={requestByName}
                disabled={submitting}
                onChange={(e) => setRequestByName(e.target.value)}
                placeholder="Name shown with your requests"
              />
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting || !userId}>{submitting ? 'Submitting...' : 'Send Request'}</button>
              <button type="button" className="btn btn-ghost" disabled={submitting} onClick={() => { setKeywords(''); }}>{'Clear'}</button>
              {userId && <span className="small muted">User ID: {userId.slice(0, 8)}…</span>}
              {realtimeEnabled && <span className="badge" style={{ background: '#065f46', color: 'white', fontSize: 10 }}>Realtime</span>}
            </div>
            {formError && <div className="form-error" style={{ color: 'crimson', fontSize: 13 }}>{formError}</div>}
            {formMsg && <div className="form-success" style={{ color: '#065f46', fontSize: 13 }}>{formMsg}</div>}
          </form>

          {/* History Section */}
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Your Requests</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" disabled={loadingHistory} onClick={() => loadHistory()}>{loadingHistory ? 'Refreshing...' : 'Refresh'}</button>
              </div>
            </div>
            {historyError && <div style={{ color: 'crimson', marginTop: 8 }}>{historyError}</div>}
            <div className="small muted" style={{ marginTop: 4 }}>Showing latest {history.length} requests (max 200).</div>
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className="data-table small">
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>Created</th>
                    <th>Keywords</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Name</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Fulfilled</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.request_id}>
                      <td title={r.created_at}>{r.created_at?.slice(0,19).replace('T',' ')}</td>
                      <td className="truncate" title={r.keywords}>{r.keywords?.slice(0,120) || '—'}</td>
                      <td>{r.request_by_name || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{r.is_fulfilled ? 'Yes' : 'No'}</td>
                      <td className="truncate" title={r.request_id}>{r.request_id?.slice(0,8)}…</td>
                    </tr>
                  ))}
                  {!history.length && !loadingHistory && <tr><td colSpan={5} className="empty">No requests yet</td></tr>}
                  {loadingHistory && <tr><td colSpan={5}>Loading…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{marginTop:40,padding:'18px 20px',background:'#fff7ed',border:'2px solid #f97316',borderRadius:10,lineHeight:1.45}}>
            <h3 style={{margin:'0 0 6px',fontSize:20,color:'#9a3412'}}>Accounts Needed</h3>
            <div style={{fontSize:15}}>
              To process your request and gather enough data, you must add <strong>at least 2–3 newly created LinkedIn accounts</strong> first. These accounts power the data collection pipeline.
              <br/>
              <Link to="/page1" style={{textDecoration:'underline',fontWeight:600}}>Go to Accounts</Link> to add them now, then return here to submit more keywords.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
