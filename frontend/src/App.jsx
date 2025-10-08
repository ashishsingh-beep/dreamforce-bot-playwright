import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./services/supabaseClient";
import LoginForm from "./components/LoginForm";
import SignupForm from "./components/SignupForm";
import Navbar from "./components/Navbar";
import Accounts from "./pages/Page1";
import Request from "./pages/Request";
import Stage1 from "./pages/Page2";
import Stage2 from "./pages/Page3";
import Stage3 from "./pages/Page4";
import RemoteAccess from "./pages/Page5";
import ForgotPasswordForm from "./components/ForgotPasswordForm";
import ResetPasswordForm from "./components/ResetPasswordForm";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Callback to update session after login/signup
  const handleAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setSession(session);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      {session && <Navbar session={session} />}

      <Routes>
        {/* Auth routes: redirect to /request if already logged in */}
        <Route
          path="/login"
          element={session ? <Navigate to="/request" replace /> : <LoginForm setIsLoggedIn={handleAuth} />}
        />
        <Route
          path="/sign-up"
          element={session ? <Navigate to="/request" replace /> : <SignupForm setIsLoggedIn={handleAuth} />}
        />
        <Route
          path="/forgot-password"
          element={session ? <Navigate to="/request" replace /> : <ForgotPasswordForm />}
        />


        {/* Protected pages */}
        <Route
          path="/reset-password"
          element={session ? <ResetPasswordForm /> : <Navigate to="/login" replace />}
        />
        <Route path="/request" element={session ? <Request /> : <Navigate to="/login" replace />} />
  <Route path="/page1" element={session ? <Accounts /> : <Navigate to="/login" replace />} />
        <Route
          path="/page2"
          element={session ? <Stage1 /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/page3"
          element={session ? <Stage2 /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/page4"
          element={session ? <Stage3 /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/page5"
          element={session ? <RemoteAccess /> : <Navigate to="/login" replace />}
        />

  {/* Root / fallback now point to /request */}
  <Route path="/" element={<Navigate to={session ? "/request" : "/login"} replace />} />
  <Route path="*" element={<Navigate to={session ? "/request" : "/login"} replace />} />
      </Routes>
      {console.log("env:", import.meta.env)}
    </>
  );
}

export default App;
