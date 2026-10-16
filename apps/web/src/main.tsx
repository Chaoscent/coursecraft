// SPDX-License-Identifier: Apache-2.0
import './lib/zod-config.js';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { applyTheme, loadTheme } from './lib/theme.js';
import './i18n/index.js';

applyTheme(loadTheme());
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
