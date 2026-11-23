import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

const rootEl = document.getElementById('dash-root')!;
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
