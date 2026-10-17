// SPDX-License-Identifier: Apache-2.0
// Test LMS: records every value the course sets and exposes it to the test.
window.API = new window.Scorm12API({ autocommit: false, logLevel: 5 });
window.lmsLog = [];
window.API.on('LMSSetValue.cmi.*', (element, value) => window.lmsLog.push([element, value]));
window.API.on('LMSInitialize', () => window.lmsLog.push(['LMSInitialize', '']));
window.API.on('LMSFinish', () => window.lmsLog.push(['LMSFinish', '']));
window.addEventListener('DOMContentLoaded', () => {
  const resume = new URLSearchParams(location.search).get('suspend');
  if (resume)
    window.API.loadFromJSON({ cmi: { suspend_data: resume, core: { lesson_status: 'incomplete' } } });
  document.getElementById('sco').src = '/pkg/index.html';
});
