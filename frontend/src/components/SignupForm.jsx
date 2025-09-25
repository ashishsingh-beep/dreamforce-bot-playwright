import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import "../styles/auth.css";

function SignupForm({ setIsLoggedIn }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(null);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setNote(null);

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp(
        { email, password },
        { data: { full_name: name } }
      );
      if (signUpError) {
        // Supabase returns a generic error, but you can check the message for duplicate email
        if (signUpError.message && signUpError.message.toLowerCase().includes("already registered")) {
          setError("This email is already registered. Please use another email or log in.");
        } else {
          setError(signUpError.message || "Signup failed");
        }
        setLoading(false);
        return;
      }

      if (data?.session) {
        setMessage("Signed up and logged in.");
        if (setIsLoggedIn) await setIsLoggedIn();
      } else {
        console.log(data);
        setMessage("Signup successful. Check your email for a confirmation link.");
        setNote("If you do not see the email, it may have landed in your spam folder or the email is already registered.");
      }
    } catch (err) {
      setError(err?.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Sign Up</h1>

        <form className="auth-form" onSubmit={handleSignup}>
          <input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            type="text"
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
          />
          <input
            placeholder="Password (min 6 chars)"
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
            <p>Already have an account?   <Link to="/login" className="link-muted">Log in</Link></p>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Signing up..." : "Sign Up"}
            </button>
          </div>

          {message && <div className="form-success" style={{ marginTop: 8 }}>{message}</div>}
          {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
          {note && <div className="form-note" style={{ marginTop: 8 }}>{note}</div> }
        </form>
      </div>
    </div>
  );
}

export default SignupForm;
