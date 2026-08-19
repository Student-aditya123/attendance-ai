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
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store'; // your Redux store
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);
