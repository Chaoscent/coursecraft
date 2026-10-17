// SPDX-License-Identifier: Apache-2.0
import type { Course } from '@lernwerk/course-model';
import { escapeXml } from './xml.js';

/** imsmanifest.xml for a single-SCO SCORM 1.2 package. */
export function scorm12Manifest(course: Course, title: string, files: string[]): string {
  const id = `lernwerk-${course.id}`;
  const t = escapeXml(title);
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1">
      <title>${t}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${t}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((f) => `      <file href="${escapeXml(f)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`;
}
