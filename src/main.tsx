import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { reactErrorHandler } from '@sentry/react';
import { App } from './App.tsx';
import { startErrorMonitoring } from './lib/sentry.ts';
import './index.css';

// Before anything mounts, so a throw during the first render is reported.
startErrorMonitoring();

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

// React 19 catches render-phase errors itself and surfaces them only through
// these callbacks — the global `error` handler Sentry installs never sees
// them, so without these a component crash reaches the console and nowhere
// else.
createRoot(container, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
