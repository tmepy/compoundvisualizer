import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ModelProvider } from './model';
import './styles.css';
import './readability.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ModelProvider><App /></ModelProvider></React.StrictMode>);
