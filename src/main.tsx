import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installStaleBuildListener } from '@/lib/staleBuild';
import './index.css';

// Un deploy borra los chunks del build anterior: si esta pestaña quedó vieja,
// recargamos sola en vez de romper con "Failed to fetch dynamically imported".
installStaleBuildListener();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
