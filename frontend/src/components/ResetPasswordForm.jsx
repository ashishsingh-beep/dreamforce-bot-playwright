import React, { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import "../styles/auth.css";

function ResetPasswordForm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("access_token") || searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // supabase handles reset via URL token; this is a placeholder flow
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage("Password updated. Please login.");
    } catch (err) {
      setError(err.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Reset Password</h1>

        <form className="auth-form" onSubmit={handleReset}>
          <input
            placeholder="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            placeholder="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />

          <div className="auth-actions">
            <Link to="/login" className="link-muted">Back to login</Link>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Updating..." : "Update password"}
            </button>
          </div>

          {message && <div className="form-success">{message}</div>}
          {error && <div className="form-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}

export default ResetPasswordForm;
