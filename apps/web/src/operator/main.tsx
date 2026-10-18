// SPDX-License-Identifier: Apache-2.0
import '../lib/zod-config.js';
import '../styles/tokens.css';
import '../styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, loadTheme } from '../lib/theme.js';
import '../i18n/index.js';
import { OperatorApp } from './OperatorApp.js';

applyTheme(loadTheme());
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OperatorApp />
    </StrictMode>,
  );
}
