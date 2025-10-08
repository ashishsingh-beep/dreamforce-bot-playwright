import React, { useState, useEffect, useRef } from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import "../styles/navbar.css";
import config from "../../config/config";

function Navbar({ session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ddRef = useRef(null);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const handleResetPassword = () => {
    navigate("/reset-password");
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const onDoc = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const path = location.pathname;
  const isTab2Active = path === "/page2" || path === "/page3" || path === "/page4";

  return (
    <header className="navbar">
      <div className="nav-left">
        <Link to="/request" className="logo">
          <img src="/vite.svg" alt="logo" className="logo-img" />
          <span className="brand">{config.appTitle}</span>
        </Link>
      </div>

      <nav className="nav-links" aria-label="Main navigation">
        <NavLink to="/request" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
          Request
        </NavLink>

        <NavLink to="/page1" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
          Add Linkedin Accounts
        </NavLink>

        <div
          className={"dropdown" + (open ? " open" : "")}
          ref={ddRef}
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={"dropdown-toggle" + (isTab2Active ? " active" : "")}
          >
            Customize Campaign
            <span className="caret" aria-hidden>▾</span>
          </button>

          <div className="dropdown-menu" role="menu">
            <NavLink to="/page2" className={({ isActive }) => "dropdown-item" + (isActive ? " active" : "")} onClick={() => setOpen(false)}>
              Stage 1 - Lead Scout
            </NavLink>
            <NavLink to="/page3" className={({ isActive }) => "dropdown-item" + (isActive ? " active" : "")} onClick={() => setOpen(false)}>
              Stage 2 - Enrichment
            </NavLink>
            <NavLink to="/page4" className={({ isActive }) => "dropdown-item" + (isActive ? " active" : "")} onClick={() => setOpen(false)}>
              Stage 3 - Filtration
            </NavLink>
          </div>
        </div>

        <NavLink to="/page5" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
          Access Tool Remotly
        </NavLink>
      </nav>

      <div className="nav-right">
        {session ? (
          <>
            <div className="user-name">{session.user?.email ?? "User"}</div>
            <button className="btn btn-ghost" onClick={handleSignOut}>
              Sign Out
            </button>
            <button onClick={handleResetPassword} className="btn btn-ghost">Reset Password</button>

          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-ghost">Login</Link>
            <Link to="/sign-up" className="btn btn-primary">Sign Up</Link>
          </>
        )}
      </div>
    </header>
  );
}

export default Navbar;
