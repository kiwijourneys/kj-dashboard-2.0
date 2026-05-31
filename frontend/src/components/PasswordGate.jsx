import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'kj_dashboard_auth';
const PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD;

export default function PasswordGate({ children }) {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If no password is configured, skip gate entirely
    if (!PASSWORD) {
      setAuthed(true);
      setChecking(false);
      return;
    }
    // Check localStorage for existing session
    try {
      if (localStorage.getItem(STORAGE_KEY) === PASSWORD) {
        setAuthed(true);
      }
    } catch {}
    setChecking(false);
  }, []);

  if (checking) return null;
  if (authed) return children;

  function handleSubmit(e) {
    e.preventDefault();
    if (input === PASSWORD) {
      try { localStorage.setItem(STORAGE_KEY, PASSWORD); } catch {}
      setAuthed(true);
    } else {
      setError(true);
      setInput('');
      setTimeout(() => setError(false), 2000);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f9fafb' }}>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 w-full max-w-sm flex flex-col items-center gap-6">
        <img src="/KJ_logo.jpg" alt="Kiwi Journeys" className="h-12 w-auto" />
        <div className="text-center">
          <h1 className="text-lg font-semibold" style={{ color: '#3b3b3b' }}>Marketing Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your password to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Password"
            autoFocus
            className={`w-full border rounded-lg px-4 py-2.5 text-sm outline-none transition-colors
              ${error
                ? 'border-red-400 bg-red-50 text-red-700 placeholder-red-300'
                : 'border-gray-300 text-gray-700 focus:border-[#99ca3c]'
              }`}
          />
          {error && <p className="text-xs text-red-500 text-center">Incorrect password — try again</p>}
          <button
            type="submit"
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#99ca3c' }}
          >
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
