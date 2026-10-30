import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installStaleBuildListener } from '@/lib/staleBuild';
import { registerPwa } from '@/lib/pwa';
import './index.css';

// Un deploy borra los chunks del build anterior: si esta pestaña quedó vieja,
// recargamos sola en vez de romper con "Failed to fetch dynamically imported".
installStaleBuildListener();

// Registra el service worker y fuerza el chequeo de actualización, para que un
// PWA con caché vieja se actualice solo sin que el usuario borre nada a mano.
registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
