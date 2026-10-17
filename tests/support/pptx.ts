// SPDX-License-Identifier: Apache-2.0
/**
 * Builds small but complete PPTX files for tests (master, layout, theme,
 * slides, notes, pictures, animations). Shapes are given as DrawingML
 * fragments, built with the helpers below.
 */
import yazl from 'yazl';

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** EMU per pixel on a 1280 px wide 16:9 slide (12192000 EMU). */
export const PX = 9525;
const box = (b: Box) =>
  `<a:xfrm><a:off x="${b.x * PX}" y="${b.y * PX}"/><a:ext cx="${b.w * PX}" cy="${b.h * PX}"/></a:xfrm>`;
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  sizePt?: number;
  /** Relationship id of an external hyperlink. */
  link?: string;
}

export function para(
  runs: (string | Run)[],
  options: { align?: 'ctr' | 'r'; bullet?: boolean; lvl?: number } = {},
) {
  const pPr = [
    options.align ? `algn="${options.align}"` : '',
    options.lvl ? `lvl="${options.lvl}"` : '',
  ].join(' ');
  const bullet =
    options.bullet === true ? '<a:buChar char="•"/>' : options.bullet === false ? '<a:buNone/>' : '';
  const body = runs
    .map((r) => (typeof r === 'string' ? { text: r } : r))
    .map((r) => {
      const attrs = [
        'lang="de-DE"',
        r.sizePt ? `sz="${r.sizePt * 100}"` : '',
        r.bold ? 'b="1"' : '',
        r.italic ? 'i="1"' : '',
      ].join(' ');
      const fill = r.color ? `<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>` : '';
      const link = r.link ? `<a:hlinkClick r:id="${r.link}"/>` : '';
      return `<a:r><a:rPr ${attrs}>${fill}${link}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
    })
    .join('');
  return `<a:p>${pPr.trim() || bullet ? `<a:pPr ${pPr}>${bullet}</a:pPr>` : ''}${body}</a:p>`;
}

const txBody = (paragraphs: string[], bodyPr = '<a:bodyPr/>') =>
  `<p:txBody>${bodyPr}<a:lstStyle/>${paragraphs.join('')}</p:txBody>`;

export function title(id: number, text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Title ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>${txBody([para([text])])}</p:sp>`
  );
}

export function body(id: number, paragraphs: string[]): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Content ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>${txBody(paragraphs)}</p:sp>`
  );
}

export function textBox(id: number, b: Box, paragraphs: string[], anchor?: 'ctr' | 'b'): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${box(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `${txBody(paragraphs, `<a:bodyPr wrap="square"${anchor ? ` anchor="${anchor}"` : ''}/>`)}</p:sp>`
  );
}

export function shape(
  id: number,
  prst: string,
  b: Box,
  options: { fill?: string; scheme?: string; line?: string; text?: string[]; descr?: string } = {},
): string {
  const fill = options.fill
    ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>`
    : options.scheme
      ? `<a:solidFill><a:schemeClr val="${options.scheme}"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>`
      : '<a:noFill/>';
  const line = options.line
    ? `<a:ln w="25400"><a:solidFill><a:srgbClr val="${options.line}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"${options.descr ? ` descr="${esc(options.descr)}"` : ''}/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${box(b)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>` +
    (options.text ? txBody(options.text, '<a:bodyPr anchor="ctr"/>') : '') +
    '</p:sp>'
  );
}

export function picture(id: number, rId: string, b: Box, descr?: string, crop?: string): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${descr ? ` descr="${esc(descr)}"` : ''}/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rId}"/>${crop ?? ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${box(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

export function group(id: number, b: Box, child: Box, content: string[]): string {
  return (
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="${b.x * PX}" y="${b.y * PX}"/><a:ext cx="${b.w * PX}" cy="${b.h * PX}"/>` +
    `<a:chOff x="${child.x * PX}" y="${child.y * PX}"/><a:chExt cx="${child.w * PX}" cy="${child.h * PX}"/></a:xfrm></p:grpSpPr>` +
    `${content.join('')}</p:grpSp>`
  );
}

export function table(id: number, b: Box): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${b.x * PX}" y="${b.y * PX}"/><a:ext cx="${b.w * PX}" cy="${b.h * PX}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${b.w * PX}"/></a:tblGrid>` +
    `<a:tr h="${b.h * PX}"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Zelle</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

/** Entrance animations: [shape id, preset id (10 fade, 2 fly), node type]. */
export function timing(steps: [number, number, 'clickEffect' | 'withEffect' | 'afterEffect'][]): string {
  let n = 3;
  const pars = steps
    .map(
      ([spid, preset, type]) =>
        `<p:par><p:cTn id="${n++}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
        `<p:par><p:cTn id="${n++}" presetID="${preset}" presetClass="entr" presetSubtype="${preset === 2 ? 4 : 0}" fill="hold" nodeType="${type}">` +
        `<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
        `<p:set><p:cBhvr><p:cTn id="${n++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
        `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:to><p:strVal val="visible"/></p:to></p:set>` +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${n++}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
        `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`,
    )
    .join('');
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${pars}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
}

export interface SlideSpec {
  shapes: string[];
  timing?: string;
  notes?: string;
  hidden?: boolean;
  background?: string;
  /** Extra relationships: rId → { image bytes } or external link. */
  images?: Record<string, { name: string; bytes: Buffer }>;
  links?: Record<string, string>;
}

export interface PresentationSpec {
  slides: SlideSpec[];
  title?: string;
  /** Slide size in EMU (default 16:9). */
  size?: { cx: number; cy: number };
  sections?: { name: string; slides: number[] }[];
  macroEnabled?: boolean;
  extraFiles?: Record<string, Buffer | string>;
}

const THEME = `<a:theme ${NS} name="Test"><a:themeElements>
<a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Test"><a:majorFont><a:latin typeface="Carlito"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Carlito"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Test"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const TREE_START =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

const MASTER = `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${TREE_START}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Titel</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr>
<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl2pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Title and Content">${TREE_START}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Titel</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (items: [string, string, string, boolean?][]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      ([id, type, target, external]) =>
        `<Relationship Id="${id}" Type="${REL}/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    )
    .join('')}</Relationships>`;

export function buildPptx(spec: PresentationSpec): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const add = (name: string, content: string | Buffer) =>
    zip.addBuffer(typeof content === 'string' ? Buffer.from(content, 'utf8') : content, name);
  const mainType = spec.macroEnabled
    ? 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
  const ov = (part: string, type: string) =>
    `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;
  add(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="emf" ContentType="image/x-emf"/>' +
      `<Override PartName="/ppt/presentation.xml" ContentType="${mainType}"/>` +
      ov('/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster+xml') +
      ov('/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout+xml') +
      ov('/ppt/theme/theme1.xml', 'theme+xml') +
      spec.slides
        .map(
          (s, i) =>
            ov(`/ppt/slides/slide${i + 1}.xml`, 'presentationml.slide+xml') +
            (s.notes ? ov(`/ppt/notesSlides/notesSlide${i + 1}.xml`, 'presentationml.notesSlide+xml') : ''),
        )
        .join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
  );
  add(
    '_rels/.rels',
    rels([
      ['rId1', 'officeDocument', 'ppt/presentation.xml'],
      ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
    ]).replace(
      `${REL}/metadata/core-properties`,
      'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
    ),
  );
  add(
    'docProps/core.xml',
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${esc(spec.title ?? '')}</dc:title></cp:coreProperties>`,
  );
  const size = spec.size ?? { cx: 12_192_000, cy: 6_858_000 };
  const sections = spec.sections
    ? '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">' +
      '<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
      spec.sections
        .map(
          (s, i) =>
            `<p14:section name="${esc(s.name)}" id="{00000000-0000-0000-0000-00000000000${i}}"><p14:sldIdLst>` +
            s.slides.map((n) => `<p14:sldId id="${255 + n}"/>`).join('') +
            '</p14:sldIdLst></p14:section>',
        )
        .join('') +
      '</p14:sectionLst></p:ext></p:extLst>'
    : '';
  add(
    'ppt/presentation.xml',
    `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${spec.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/>${sections}</p:presentation>`,
  );
  add(
    'ppt/_rels/presentation.xml.rels',
    rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'theme', 'theme/theme1.xml'],
      ...spec.slides.map((_, i): [string, string, string] => [
        `rId${i + 10}`,
        'slide',
        `slides/slide${i + 1}.xml`,
      ]),
    ]),
  );
  add('ppt/theme/theme1.xml', XML + THEME);
  add('ppt/slideMasters/slideMaster1.xml', XML + MASTER);
  add(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
  );
  add('ppt/slideLayouts/slideLayout1.xml', XML + LAYOUT);
  add(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
  );

  spec.slides.forEach((slide, i) => {
    const n = i + 1;
    const bg = slide.background
      ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${slide.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
      : '';
    add(
      `ppt/slides/slide${n}.xml`,
      `${XML}<p:sld ${NS}${slide.hidden ? ' show="0"' : ''}><p:cSld>${bg}${TREE_START}${slide.shapes.join('')}</p:spTree></p:cSld>` +
        `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${slide.timing ?? ''}</p:sld>`,
    );
    const slideRels: [string, string, string, boolean?][] = [
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ];
    for (const [rId, image] of Object.entries(slide.images ?? {})) {
      slideRels.push([rId, 'image', `../media/${image.name}`]);
      add(`ppt/media/${image.name}`, image.bytes);
    }
    for (const [rId, href] of Object.entries(slide.links ?? {}))
      slideRels.push([rId, 'hyperlink', href, true]);
    if (slide.notes) {
      slideRels.push(['rId99', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      add(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `${XML}<p:notes ${NS}><p:cSld>${TREE_START}` +
          '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
          `${txBody([para([slide.notes])])}</p:sp></p:spTree></p:cSld></p:notes>`,
      );
      add(
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        rels([['rId1', 'slide', `../slides/slide${n}.xml`]]),
      );
    }
    add(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
  });
  for (const [name, content] of Object.entries(spec.extraFiles ?? {})) add(name, content);

  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}
