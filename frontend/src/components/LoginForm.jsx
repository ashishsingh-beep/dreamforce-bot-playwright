import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import "../styles/auth.css";

function LoginForm({ setIsLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // notify parent to refresh session
      if (setIsLoggedIn) await setIsLoggedIn();
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Login</h1>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="auth-actions">
            <Link to="/forgot-password" className="link-muted">
              Forgot password?
            </Link>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>
          </div>

          {error && <div className="form-error">{error}</div>}
        </form>


          <p>Don't have an account?   <Link className="link-muted" to="/sign-up">Sign Up</Link></p>

      </div>
    </div>
  );
}

export default LoginForm;
