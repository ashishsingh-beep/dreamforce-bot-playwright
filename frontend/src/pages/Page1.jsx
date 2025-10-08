import React, { useEffect, useState, useRef } from "react";
import "../styles/page1.css";
import { supabase } from "../services/supabaseClient";

function Accounts() {
  const [emailId, setEmailId] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("temp");
  const [createdBy, setCreatedBy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // For update/details section
  const [found, setFound] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("temp");
  const [updating, setUpdating] = useState(false);

  // accounts list for dropdown
  const [accountsList, setAccountsList] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const listRef = useRef(null);

  // bulk update state
  const [bulkStatusTarget, setBulkStatusTarget] = useState("active");
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (mounted) setCreatedBy(data?.user?.id ?? null);
      } catch (e) {
        if (mounted) setCreatedBy(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    fetchAccountsList();

    // close dropdown on outside click
    const onDoc = (e) => {
      if (listRef.current && !listRef.current.contains(e.target)) {
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAccountsList = async () => {
    setLoadingList(true);
    try {
      // use email_id as the identifier (no `id` column in your table)
      const { data, error } = await supabase
        .from("accounts")
        .select("email_id,status,created_at,created_by,password")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setAccountsList(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("fetchAccountsList:", e);
      setAccountsList([]);
    } finally {
      setLoadingList(false);
    }
  };

  const clearMessages = () => {
    setMsg(null);
    setErr(null);
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!createdBy) {
      setErr("You must be signed in to save an account (created_by).");
      return;
    }
    if (!emailId?.trim()) {
      setErr("Please provide an email or identifier.");
      return;
    }
    if (!password) {
      setErr("Please provide a password.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email_id: emailId.trim(),
        password,
        status,
        created_by: createdBy,
      };
      const { data, error } = await supabase.from("accounts").insert([payload]).select();
      if (error) throw error;
      setMsg("Account saved to database.");
      setEmailId("");
      setPassword("");
      setStatus("temp");
      fetchAccountsList();
    } catch (e) {
      setErr(e?.message || "Failed to save account.");
    } finally {
      setLoading(false);
      setTimeout(() => {
        setMsg(null);
        setErr(null);
      }, 4000);
    }
  };

  // fetch full record by email_id (not id)
  const selectAccount = async (acc) => {
    if (!acc?.email_id) return;
    setListOpen(false);
    clearMessages();
    setFetching(true);
    try {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("email_id", acc.email_id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setErr("Selected account not found.");
        setFound(null);
      } else {
        setFound(data);
        setUpdateStatus(data.status ?? "temp");
      }
    } catch (e) {
      setErr(e?.message || "Failed to fetch account.");
    } finally {
      setFetching(false);
    }
  };

  // Update selected account: use email_id to match row
  const handleUpdateAccount = async (e) => {
    e?.preventDefault();
    clearMessages();
    if (!found) {
      setErr("No account selected to update.");
      return;
    }

    const canSetCreatedBy = !found.created_by; // only allow if created_by is null/empty
    const newCreatedBy = canSetCreatedBy ? createdBy : found.created_by;

    if (!newCreatedBy) {
      setErr("You must be signed in to set created_by.");
      return;
    }

    setUpdating(true);
    try {
      const updates = { status: updateStatus };
      if (canSetCreatedBy && newCreatedBy) updates.created_by = newCreatedBy;

      const { data, error } = await supabase
        .from("accounts")
        .update(updates)
        .eq("email_id", found.email_id)
        .select()
        .maybeSingle();

      if (error) throw error;
      setFound(data);
      setMsg("Account updated successfully.");
      fetchAccountsList();
    } catch (e) {
      setErr(e?.message || "Failed to update account.");
    } finally {
      setUpdating(false);
      setTimeout(() => {
        setMsg(null);
        setErr(null);
      }, 4000);
    }
  };

  // Bulk update handler: set status for all accounts older than 24h
  const handleBulkUpdate = async () => {
    clearMessages();
    if (!createdBy) {
      setErr("You must be signed in to perform bulk updates.");
      return;
    }
    const confirmText = `Change status to "${bulkStatusTarget}" for ALL accounts older than 24 hours? This cannot be undone.`;
    if (!window.confirm(confirmText)) return;

    setBulkLoading(true);
    try {
      // compute ISO string for 24h ago
      const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("accounts")
        .update({ status: bulkStatusTarget })
        .lt("created_at", threshold);
      if (error) throw error;
      setMsg(`Bulk update complete. Accounts older than 24h set to ${bulkStatusTarget}.`);
      fetchAccountsList();
    } catch (e) {
      setErr(e?.message || "Bulk update failed.");
    } finally {
      setBulkLoading(false);
      setTimeout(() => {
        setMsg(null);
        setErr(null);
      }, 5000);
    }
  };

  return (
    <div className="page1">
      <div className="hero">
        <div className="card">
          <h2>Quick guide — create a LinkedIn account (using temporary email/phone)</h2>

          <ol>
            <li>Open a temporary email provider (e.g., temp-mail.org) or use a temp phone SMS service.</li>
            <li>Go to https://www.linkedin.com and click "Join now".</li>
            <li>Enter the temporary email or temp phone number, full name and an easy-to-remember password (you will store it below).</li>
            <li>Complete the verification step (confirm via the temp email inbox or SMS code).</li>
            <li>Finish setup: add a profile photo later if desired. Keep the temporary address as backup.</li>
            <li>After the account is created, add the account's email and password to the form below to save it in the "accounts" table.</li>
          </ol>

          {/* Bulk status update section */}
          <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--border-color)", borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Bulk status update (older than 24h)</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
                Target status
                <select
                  className="status-select"
                  value={bulkStatusTarget}
                  onChange={(e) => setBulkStatusTarget(e.target.value)}
                  style={{ minWidth: 140 }}
                  disabled={bulkLoading}
                >
                  <option value="active">active</option>
                  <option value="temp">temp</option>
                  <option value="flagged">flagged</option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={bulkLoading}
                onClick={handleBulkUpdate}
              >
                {bulkLoading ? "Updating..." : "Apply to old accounts"}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Applies to all rows where created_at is older than 24h.
              </span>
            </div>
          </div>
          {/* end bulk status update */}

          {/* accounts dropdown (color coded) */}
          <div style={{ marginTop: 12 }} ref={listRef}>
            <div className="accounts-dropdown">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setListOpen((s) => !s)}
                aria-expanded={listOpen}
              >
                {listOpen ? "Close accounts" : `Accounts (${accountsList.length})`}
              </button>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={fetchAccountsList}
                style={{ marginLeft: 8 }}
              >
                Refresh
              </button>

              {listOpen && (
                <div className="accounts-list" role="list">
                  {loadingList && <div className="muted" style={{ padding: 8 }}>Loading…</div>}
                  {!loadingList && accountsList.length === 0 && (
                    <div className="muted" style={{ padding: 8 }}>No accounts found</div>
                  )}
                  {!loadingList && accountsList.map((acc) => (
                    <button
                      key={acc.email_id}
                      type="button"
                      className={`account-item ${acc.status || "temp"}`}
                      onClick={() => selectAccount(acc)}
                      role="listitem"
                      aria-label={`Select ${acc.email_id}, status ${acc.status || "temp"}`}
                    >
                      <span className="account-name">{acc.email_id}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`status-dot ${acc.status || "temp"}`} aria-hidden="true"></span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          {acc.created_at ? new Date(acc.created_at).toLocaleString() : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                  <div className="accounts-note" aria-hidden="true">
                    <div className="legend"><span className="dot dot--active"></span> active</div>
                    <div className="legend"><span className="dot dot--temp"></span> temp</div>
                    <div className="legend"><span className="dot dot--flagged"></span> flagged</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* end accounts dropdown */}

        </div>
      </div>

      <div className="card" style={{ marginTop: 18, maxWidth: 760, marginLeft: "auto", marginRight: "auto" }}>
        <h2>Save account to Supabase (Accounts table)</h2>

        <form className="auth-form" onSubmit={handleAddAccount} style={{ marginTop: 8 }}>
          <label>
            Email (email_id)
            <input
              type="text"
              placeholder="email@example.com"
              value={emailId}
              onChange={(e) => setEmailId(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="text"
              placeholder="Password (will be stored as provided)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <label>
            Status
            <select className="status-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">active</option>
              <option value="temp">temp</option>
              <option value="flagged">flagged</option>
            </select>
          </label>

          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save to Accounts"}
            </button>
            <div style={{ marginLeft: 12, color: "#6b7280" }}>
              Created by: {createdBy ?? "not signed in"}
            </div>
          </div>

          {msg && <div className="form-success" style={{ marginTop: 12 }}>{msg}</div>}
          {err && <div className="form-error" style={{ marginTop: 12 }}>{err}</div>}
        </form>
      </div>

      {/* Update / Details section */}
      <div className="card" style={{ marginTop: 18, maxWidth: 760, marginLeft: "auto", marginRight: "auto" }}>
        <h2>Selected account details & update</h2>

        {fetching && <div className="muted">Loading selected account…</div>}

        {found ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Email:</strong> {found.email_id}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Stored password:</strong> {found.password}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Current status:</strong> {found.status}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Created by:</strong> {found.created_by ?? "null"}
            </div>

            <form onSubmit={handleUpdateAccount} style={{ marginTop: 8 }}>
              <label>
                Set status
                <select className="status-select" value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)}>
                  <option value="active">active</option>
                  <option value="temp">temp</option>
                  <option value="flagged">flagged</option>
                </select>
              </label>

              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn-primary" type="submit" disabled={updating}>
                  {updating ? "Updating..." : "Update"}
                </button>

                <div style={{ color: "#6b7280" }}>
                  Note: created_by can only be set if current record has created_by = null. (You are: {createdBy ?? "not signed in"})
                </div>
              </div>
            </form>
          </div>
        ) : (
          <div style={{ marginTop: 12, color: "#6b7280" }}>
            No account selected. Open the Accounts dropdown and pick an account to edit.
          </div>
        )}

        {msg && <div className="form-success" style={{ marginTop: 12 }}>{msg}</div>}
        {err && <div className="form-error" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  );
}

export default Accounts;