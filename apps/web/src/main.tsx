import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './store/preferences';
import './styles.css';

// Home lives at /discover. Swap the URL before the first render so the address bar
// never shows "/" while the session check is still loading.
if (window.location.pathname === '/') {
  window.history.replaceState(window.history.state, '', `/discover${window.location.search}${window.location.hash}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
