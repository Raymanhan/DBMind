import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/layout.css';
import './styles/theme-light.css';
import './styles/rail.css';
import './styles/sidebar.css';
import './styles/ai-panel.css';
import './styles/workspace.css';
import './styles/datatable.css';
import './styles/schema-card.css';
import './styles/composer.css';
import './styles/history.css';
import './styles/settings.css';
import './styles/modals.css';
import './styles/batch-edit.css';
import './styles/sql-editor.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
