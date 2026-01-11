import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

const THEME_STORAGE_KEY = 'llm_council_theme';

// Apply theme before React renders to avoid a flash of the wrong theme.
(() => {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
      return;
    }
  } catch {
    // ignore
  }

  try {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
