/**
 * main.jsx — React application entry point
 *
 * Global CSS import order matters:
 *   1. Tailwind base/components/utilities
 *   2. Custom global overrides
 *
 * StrictMode is on in development:
 *   - Double-invokes effects to catch side-effect bugs
 *   - Does NOT affect production behaviour
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
