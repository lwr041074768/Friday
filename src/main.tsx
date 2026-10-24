import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PlotStudio from './app/plot-studio';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The plotting app root is missing.');
createRoot(root).render(<StrictMode><PlotStudio /></StrictMode>);
