import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App.tsx';
import { reactErrorReporter, startErrorMonitoring } from '@/lib/sentry.ts';
import './index.css';

// Started before anything mounts, so a throw during the first render is
// reported. The SDK itself loads in the background — startErrorMonitoring
// buffers until it arrives, so nothing thrown in the meantime is lost.
void startErrorMonitoring();

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

// React 19 catches render-phase errors itself and surfaces them only through
// these callbacks — the global `error` handler never sees them, so without
// these a component crash reaches the console and nowhere else.
createRoot(container, {
  onUncaughtError: reactErrorReporter(),
  onCaughtError: reactErrorReporter(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
