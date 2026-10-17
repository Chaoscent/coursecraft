// SPDX-License-Identifier: Apache-2.0
import { posix } from 'node:path';
import { AppError } from '../../http/errors.js';
import { safeEntryPath, type ZipArchive } from '../../lib/zip.js';
import { attr, parseXml, type Element } from '../pptx/xml.js';

export type ForeignKind = 'scorm12' | 'scorm2004' | 'xapi' | 'cmi5';

/** What the LMS needs to launch an imported package. */
export interface PackageManifest {
  kind: ForeignKind;
  title: string;
  /** Path of the launch file inside the package. */
  launchPath: string;
  /** Query string to append on launch (SCORM `parameters`), without `?`. */
  launchQuery: string;
  /** xAPI / cmi5 activity id of the course or AU. */
  activityId: string | null;
  /** 0..1 */
  masteryScore: number | null;
  /** cmi5 moveOn criterion. */
  moveOn: string | null;
  /** More than one SCO or AU: only the first is launched. */
  multipleUnits: boolean;
}

const invalid = (message: string) => new AppError('invalid_file', message);
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

/** Elements by local name, ignoring namespaces (manifests mix many schema versions). */
function all(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  const list = el.getElementsByTagNameNS('*', name);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) out.push(item);
  }
  return out;
}

function first(el: Element | null | undefined, name: string): Element | null {
  return all(el, name)[0] ?? null;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

function localPath(base: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//'))
    throw invalid('The package launches an external address');
  const [path = ''] = href.split(/[?#]/);
  const joined = posix.normalize(posix.join(base, decodeURIComponent(path)));
  const safe = safeEntryPath(joined);
  if (!safe) throw invalid('Unsafe launch path in the manifest');
  return safe;
}

function queryOf(href: string): string {
  const q = href.indexOf('?');
  return q >= 0 ? (href.slice(q + 1).split('#')[0] ?? '') : '';
}

function scorm(doc: Element, zip: ZipArchive): PackageManifest {
  const schemaVersion = text(first(doc, 'schemaversion'));
  const attributes = doc.attributes;
  const xml = Array.from({ length: attributes.length }, (_, i) => attributes.item(i)?.value ?? '').join(' ');
  const is2004 =
    /2004|CAM 1\.3/i.test(schemaVersion) ||
    xml.includes('adlcp_v1p3') ||
    (!schemaVersion && !xml.includes('adlcp_rootv1p2'));
  const organizations = first(doc, 'organizations');
  const defaultOrg = attr(organizations, 'default');
  const orgs = all(organizations, 'organization');
  const org = orgs.find((o) => attr(o, 'identifier') === defaultOrg) ?? orgs[0] ?? null;
  const resources = all(first(doc, 'resources'), 'resource');
  const launchable = all(org, 'item').filter((item) => attr(item, 'identifierref'));
  const item = launchable[0];
  const resource = item
    ? resources.find((r) => attr(r, 'identifier') === attr(item, 'identifierref'))
    : resources.find((r) => attr(r, 'href'));
  const href = attr(resource, 'href');
  if (!resource || !href) throw invalid('The manifest names no launchable resource');
  const base = [attr(doc, 'xml:base'), attr(first(doc, 'resources'), 'xml:base'), attr(resource, 'xml:base')]
    .filter((b): b is string => !!b)
    .join('/');
  const launchPath = localPath(base, href);
  if (!zip.has(launchPath)) throw invalid('The launch file is missing from the package');
  const params = attr(item, 'parameters') ?? '';
  const query = [queryOf(href), params.replace(/^[?&]/, '')].filter(Boolean).join('&');

  let mastery: number | null = null;
  if (is2004) {
    const measure = first(item, 'minNormalizedMeasure');
    const value = Number(text(measure));
    if (measure && Number.isFinite(value)) mastery = Math.min(1, Math.max(0, value));
  } else {
    const value = Number(text(first(item, 'masteryscore')));
    if (Number.isFinite(value) && text(first(item, 'masteryscore')))
      mastery = Math.min(1, Math.max(0, value / 100));
  }
  return {
    kind: is2004 ? 'scorm2004' : 'scorm12',
    title: (text(first(org, 'title')) || text(first(item, 'title')) || 'SCORM').slice(0, 200),
    launchPath,
    launchQuery: query,
    activityId: null,
    masteryScore: mastery,
    moveOn: null,
    multipleUnits: launchable.length > 1,
  };
}

function tincan(doc: Element, zip: ZipArchive): PackageManifest {
  const activities = all(doc, 'activity');
  const course = activities.find((a) => attr(a, 'type')?.endsWith('/course')) ?? activities[0];
  const launch = first(course, 'launch');
  const href = text(launch);
  const id = attr(course, 'id');
  if (!course || !href || !id) throw invalid('tincan.xml names no course activity with launch file');
  const launchPath = localPath('', href);
  if (!zip.has(launchPath)) throw invalid('The launch file is missing from the package');
  return {
    kind: 'xapi',
    title: (text(first(course, 'name')) || 'xAPI').slice(0, 200),
    launchPath,
    launchQuery: queryOf(href),
    activityId: id,
    masteryScore: null,
    moveOn: null,
    multipleUnits: false,
  };
}

function cmi5(doc: Element, zip: ZipArchive): PackageManifest {
  const aus = all(doc, 'au');
  const au = aus[0];
  const href = text(first(au, 'url'));
  const id = attr(au, 'id');
  if (!au || !href || !id) throw invalid('cmi5.xml names no assignable unit');
  const launchPath = localPath('', href);
  if (!zip.has(launchPath)) throw invalid('The launch file is missing from the package');
  const mastery = Number(attr(au, 'masteryScore'));
  return {
    kind: 'cmi5',
    title: (text(first(first(doc, 'course'), 'langstring')) || text(first(au, 'langstring')) || 'cmi5').slice(
      0,
      200,
    ),
    launchPath,
    launchQuery: queryOf(href),
    activityId: id,
    masteryScore:
      Number.isFinite(mastery) && attr(au, 'masteryScore') ? Math.min(1, Math.max(0, mastery)) : null,
    moveOn: attr(au, 'moveOn') ?? 'NotApplicable',
    multipleUnits: aus.length > 1,
  };
}

/** Detects the package type from its manifest and reads the launch information. */
export async function readManifest(zip: ZipArchive): Promise<PackageManifest> {
  const read = async (name: string) => {
    if (zip.size(name) > MAX_MANIFEST_BYTES) throw invalid('Manifest too large');
    const root = parseXml(await zip.read(name)).documentElement;
    if (!root) throw invalid('Empty manifest');
    return root;
  };
  if (zip.has('cmi5.xml')) return cmi5(await read('cmi5.xml'), zip);
  if (zip.has('tincan.xml')) return tincan(await read('tincan.xml'), zip);
  if (zip.has('imsmanifest.xml')) return scorm(await read('imsmanifest.xml'), zip);
  throw new AppError('unsupported_media_type', 'No SCORM, xAPI or cmi5 manifest found');
}
