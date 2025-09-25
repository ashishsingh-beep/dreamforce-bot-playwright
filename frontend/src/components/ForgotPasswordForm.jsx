import React, { useState } from "react";
import "../styles/auth.css";
import { supabase } from "../services/supabaseClient";
import { Link } from "react-router-dom";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setMessage("If the email exists you will receive password reset instructions.");
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Forgot Password</h1>

        <form className="auth-form" onSubmit={handleRequest}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
          />

          <div className="auth-actions">
            <Link to="/login" className="link-muted">Back to login</Link>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </div>

          {message && <div className="form-success">{message}</div>}
          {error && <div className="form-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}

export default ForgotPasswordForm;
