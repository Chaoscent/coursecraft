# Third-party notices

Lernwerk is licensed under the Apache License 2.0. The container images also
contain separately licensed programs. They are used only as separate
processes and are never linked into Lernwerk code. Combining them in one
image is aggregation; it does not change the license of Lernwerk or of these
programs.

## Programs from Debian (container images)

Base image: `node:24-trixie-slim` (Debian 13 "trixie").

| Package                                                    | Image     | License                                       | Use                                                     |
| ---------------------------------------------------------- | --------- | --------------------------------------------- | ------------------------------------------------------- |
| libreoffice-impress-nogui (and dependencies)               | converter | MPL-2.0, with components under other licenses | Convert uploaded presentations to PDF                   |
| ffmpeg (and libav* libraries, libx264, libvpx, libopus, …) | converter | GPL-2.0-or-later (Debian build)               | Transcode and edit media                                |
| fonts-crosextra-carlito                                    | converter | OFL-1.1                                       | Metric-compatible substitute for Calibri                |
| fonts-crosextra-caladea                                    | converter | Apache-2.0                                    | Metric-compatible substitute for Cambria                |
| fonts-liberation                                           | converter | OFL-1.1                                       | Metric-compatible substitutes for Arial, Times, Courier |
| fonts-dejavu-core                                          | converter | Bitstream Vera / public domain                | Fallback font                                           |
| postgresql-client-17                                       | app       | PostgreSQL                                    | `pg_dump` / `psql` for backup and restore               |

**Source code.** The complete corresponding source code of every Debian
package in the images, including the GPL-licensed ffmpeg build, is available
from the Debian archive: <https://sources.debian.org/> and
`deb-src http://deb.debian.org/debian trixie main` (`apt-get source <package>`).
Package versions in a given image can be listed with
`docker run --rm <image> dpkg-query -W`.

The full license texts are included in each image under
`/usr/share/doc/<package>/copyright`.

## Fonts and icons in the web application

| Component                                                | Version / source         | License                   | Location                     | License file                        |
| -------------------------------------------------------- | ------------------------ | ------------------------- | ---------------------------- | ----------------------------------- |
| IBM Plex Sans (Regular, Italic, Medium, SemiBold, Bold)  | IBM Plex release (woff2) | SIL Open Font License 1.1 | `apps/web/src/assets/fonts/` | `apps/web/src/assets/fonts/OFL.txt` |
| IBM Plex Mono (Regular)                                  | IBM Plex release (woff2) | SIL Open Font License 1.1 | `apps/web/src/assets/fonts/` | `apps/web/src/assets/fonts/OFL.txt` |
| Lucide icons (149 selected, stroke width changed to 1.5) | lucide-static 1.57       | ISC                       | `apps/web/src/assets/icons/` | `apps/web/src/assets/icons/LICENSE` |

Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". The fonts are
distributed unmodified and are not sold separately. The web build copies
them, with hashed file names, into the application bundle.

## Files bundled inside pdf.js (converter image only)

`pdfjs-dist` (Apache-2.0) contains data files that the converter uses to
render slide images. They stay in the package directory, unmodified, with
their license files next to them:

- `standard_fonts/`: Foxit fonts (BSD-3-Clause, PDFium Authors) and
  Liberation Sans (SIL OFL 1.1). Used only for rendering, never shipped in
  courses.
- `wasm/`: OpenJPEG decoder (BSD-2-Clause), JBIG2 decoder from PDFium
  (BSD-3-Clause), qcms colour management (MIT).
- `iccs/`: colour profile (CC0-1.0).
- `cmaps/`: Adobe CMap resources (BSD-3-Clause).

## npm packages

See `docs/dependencies.md`. All npm dependencies are checked against an
allowlist of Apache-2.0-compatible licenses on every CI run.
