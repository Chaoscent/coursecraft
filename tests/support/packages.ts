// SPDX-License-Identifier: Apache-2.0
/** Minimal third-party learning packages (SCORM 1.2 / 2004, Tin Can) for tests. */
import yazl from 'yazl';

export function zipFiles(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files))
    zip.addBuffer(typeof content === 'string' ? Buffer.from(content, 'utf8') : content, name);
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

/**
 * SCORM 1.2 SCO: a button "Abschließen" sets score 80, an interaction and
 * passed; the visit counter in suspend_data shows resume works.
 */
const SCO_12 = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>SCO</title><script src="sco.js"></script></head>
<body><h1>Fremdkurs SCORM</h1><p id="visits"></p><button id="done" type="button">Abschließen</button><p id="status"></p></body></html>`;

const SCO_12_JS = `function findAPI(w) { while (w) { if (w.API) return w.API; if (w === w.parent) break; w = w.parent; } return null; }
window.addEventListener('DOMContentLoaded', function () {
  var api = findAPI(window.parent);
  api.LMSInitialize('');
  var visits = Number(api.LMSGetValue('cmi.suspend_data') || '0') + 1;
  api.LMSSetValue('cmi.suspend_data', String(visits));
  api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
  api.LMSSetValue('cmi.core.exit', 'suspend');
  api.LMSCommit('');
  document.getElementById('visits').textContent = 'Besuch ' + visits + ', Lernender ' + api.LMSGetValue('cmi.core.student_name');
  document.getElementById('done').addEventListener('click', function () {
    api.LMSSetValue('cmi.core.score.raw', '80');
    api.LMSSetValue('cmi.interactions.0.id', 'frage-1');
    api.LMSSetValue('cmi.interactions.0.type', 'choice');
    api.LMSSetValue('cmi.interactions.0.student_response', 'b');
    api.LMSSetValue('cmi.interactions.0.result', 'correct');
    api.LMSSetValue('cmi.core.lesson_status', 'passed');
    api.LMSSetValue('cmi.core.session_time', '00:02:30');
    api.LMSSetValue('cmi.core.exit', '');
    api.LMSCommit('');
    api.LMSFinish('');
    document.getElementById('status').textContent = 'Fertig';
  });
});
`;

export function scorm12Package(
  options: { title?: string; href?: string; mastery?: number } = {},
): Promise<Buffer> {
  const href = options.href ?? 'content/index.html';
  return zipFiles({
    'imsmanifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="test" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1"><title>${options.title ?? 'Fremdkurs SCORM'}</title>
      <item identifier="i1" identifierref="r1"><title>SCO</title>${
        options.mastery !== undefined ? `<adlcp:masteryscore>${options.mastery}</adlcp:masteryscore>` : ''
      }</item>
    </organization>
  </organizations>
  <resources><resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="${href}"><file href="content/index.html"/></resource></resources>
</manifest>`,
    'content/index.html': SCO_12,
    'content/sco.js': SCO_12_JS,
  });
}

export function scorm2004Package(): Promise<Buffer> {
  return zipFiles({
    'imsmanifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="t2004" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="o"><organization identifier="o"><title>Kurs 2004</title>
    <item identifier="i" identifierref="r"><title>SCO</title>
      <imsss:sequencing><imsss:objectives><imsss:primaryObjective objectiveID="p" satisfiedByMeasure="true">
        <imsss:minNormalizedMeasure>0.7</imsss:minNormalizedMeasure></imsss:primaryObjective></imsss:objectives></imsss:sequencing>
    </item><item identifier="i2" identifierref="r"><title>Zweites SCO</title></item>
  </organization></organizations>
  <resources><resource identifier="r" type="webcontent" adlcp:scormType="sco" href="index.html?mode=a"/></resources>
</manifest>`,
    'index.html': '<!doctype html><title>x</title><p>2004</p>',
  });
}

export function tincanPackage(): Promise<Buffer> {
  return zipFiles({
    'tincan.xml': `<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd"><activities>
  <activity id="https://example.org/kurs/brandschutz" type="http://adlnet.gov/expapi/activities/course">
    <name>Brandschutz xAPI</name><launch lang="de">start.html</launch></activity>
</activities></tincan>`,
    'start.html': '<!doctype html><title>xAPI</title><p>xAPI</p>',
  });
}
