import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Bundled mono font: rendering must not depend on what the system happens to
// have installed. The --font-mono stack still prefers system Fira Code (with
// Nerd glyph patches) when present; this guarantees the baseline.
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/700.css';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
