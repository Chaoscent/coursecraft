// SPDX-License-Identifier: Apache-2.0
window.API_1484_11 = new window.Scorm2004API({ autocommit: false, logLevel: 5 });
window.lmsLog = [];
window.API_1484_11.on('SetValue.cmi.*', (element, value) => window.lmsLog.push([element, value]));
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sco').src = '/pkg/index.html';
});
