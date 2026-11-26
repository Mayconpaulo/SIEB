import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAutoUpdateWatcher } from './lib/autoUpdate';

initAutoUpdateWatcher();

createRoot(document.getElementById('root')!).render(<App />);
