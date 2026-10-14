import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { StoreProvider } from './state/store';
import { applyTheme, savedTheme } from './ui/ThemeToggle';

applyTheme(savedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
