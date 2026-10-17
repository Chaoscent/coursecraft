// SPDX-License-Identifier: Apache-2.0
import type { Course } from '@lernwerk/course-model';
import { escapeXml } from './xml.js';

/** Stable activity IRIs (URNs) for xAPI and cmi5 packages. */
export const courseIri = (course: Course) => `urn:lernwerk:course:${course.id}`;
export const auIri = (course: Course) => `urn:lernwerk:course:${course.id}:au`;

function langStrings(tag: string, values: Record<string, string> | undefined, fallback: string): string {
  const entries = Object.entries(values ?? {}).filter(([, v]) => v);
  if (!entries.length) return `<${tag}><langstring lang="und">${escapeXml(fallback)}</langstring></${tag}>`;
  return `<${tag}>${entries.map(([lang, v]) => `<langstring lang="${escapeXml(lang)}">${escapeXml(v)}</langstring>`).join('')}</${tag}>`;
}

/** Mastery score (0..1) when completion requires passing a quiz. */
export function masteryScore(course: Course): number | undefined {
  const rule = course.settings.completion;
  if (rule.type !== 'quizPassed') return undefined;
  const quiz = course.nodes[rule.quizId];
  return quiz?.kind === 'quiz' ? quiz.settings.passingPercent / 100 : undefined;
}

export function scorm2004Manifest(course: Course, title: string, files: string[], edition: 3 | 4): string {
  const t = escapeXml(title);
  const mastery = masteryScore(course);
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="lernwerk-${course.id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 ${edition === 3 ? '3rd' : '4th'} Edition</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1">
      <title>${t}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${t}</title>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>${
            mastery !== undefined
              ? `
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary" satisfiedByMeasure="false">
              <imsss:minNormalizedMeasure>${mastery.toFixed(2)}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>`
              : ''
          }
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormType="sco" href="index.html">
${files.map((f) => `      <file href="${escapeXml(f)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`;
}

export function tincanManifest(course: Course, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${escapeXml(courseIri(course))}" type="http://adlnet.gov/expapi/activities/course">
      <name>${escapeXml(title)}</name>
      <description lang="${escapeXml(course.languages.default)}">${escapeXml(course.meta.description?.[course.languages.default] ?? '')}</description>
      <launch lang="und">index.html</launch>
    </activity>
  </activities>
</tincan>
`;
}

export function cmi5Manifest(course: Course, title: string): string {
  const mastery = masteryScore(course);
  const moveOn = mastery !== undefined ? 'Passed' : 'Completed';
  return `<?xml version="1.0" encoding="UTF-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="${escapeXml(courseIri(course))}">
    ${langStrings('title', course.meta.title, title)}
    ${langStrings('description', course.meta.description, title)}
  </course>
  <au id="${escapeXml(auIri(course))}" moveOn="${moveOn}"${mastery !== undefined ? ` masteryScore="${mastery.toFixed(2)}"` : ''} launchMethod="AnyWindow">
    ${langStrings('title', course.meta.title, title)}
    ${langStrings('description', course.meta.description, title)}
    <url>index.html</url>
  </au>
</courseStructure>
`;
}
