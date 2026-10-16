// SPDX-License-Identifier: Apache-2.0
// Theme toggle for the static sample pages (external file: no inline scripts).
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const initial = params.get('theme');
if (initial === 'dark' || initial === 'light') root.dataset.theme = initial;

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const dark =
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
});
