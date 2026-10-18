#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# SCORM conformance against a real LMS: installs a throwaway Moodle 4.5 LTS,
# exports Coursecraft courses as SCORM 1.2 and SCORM 2004, imports and plays
# them in Moodle as a learner would (tests/e2e/moodle), and checks what Moodle
# recorded. Images must be built beforehand (scripts/ci/build-images.sh).
set -eu
cd "$(dirname "$0")/../.."
BRANCH=MOODLE_405_STABLE
export MOODLE_PORT=3200 MOODLE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/coursecraft/moodle-405"
MOODLE="docker compose -f tests/moodle/compose.yml"

if [ ! -d "$MOODLE_DIR/.git" ]; then
  mkdir -p "$(dirname "$MOODLE_DIR")"
  git clone --quiet --depth 1 --branch "$BRANCH" https://github.com/moodle/moodle.git "$MOODLE_DIR"
fi
cat >"$MOODLE_DIR/config.php" <<PHP
<?php
unset(\$CFG);
global \$CFG;
\$CFG = new stdClass();
\$CFG->dbtype = 'pgsql';
\$CFG->dblibrary = 'native';
\$CFG->dbhost = 'db';
\$CFG->dbname = 'moodle';
\$CFG->dbuser = 'moodle';
\$CFG->dbpass = 'moodle';
\$CFG->prefix = 'mdl_';
\$CFG->dboptions = [];
\$CFG->wwwroot = 'http://localhost:$MOODLE_PORT';
\$CFG->dataroot = '/var/www/moodledata';
\$CFG->admin = 'admin';
\$CFG->directorypermissions = 02777;
require_once(__DIR__ . '/lib/setup.php');
PHP

cleanup() { $MOODLE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
$MOODLE up -d --wait --wait-timeout 120
echo "Installing Moodle …"
$MOODLE exec -T -u www-data moodle php admin/cli/install_database.php --agree-license \
  --fullname=Conformance --shortname=conformance --adminuser=admin --adminpass='Admin-pass-123!' \
  --adminemail=admin@example.com >/dev/null
# No guided tours over the pages the test drives.
$MOODLE exec -T db psql -U moodle -d moodle -qc 'update mdl_tool_usertours_tours set enabled = 0'
printf 'shortname,fullname,category\ncoursecraft,Coursecraft conformance,1\n' |
  $MOODLE exec -T -u www-data moodle sh -c 'cat >/tmp/courses.csv && php admin/tool/uploadcourse/cli/uploadcourse.php --mode=createnew --file=/tmp/courses.csv >/dev/null'

E2E_MOODLE_URL="http://localhost:$MOODLE_PORT" scripts/ci/e2e.sh --project=app-setup --project=moodle

# What Moodle stored for each package (its own record of the learner's attempt).
tracks() {
  $MOODLE exec -T db psql -U moodle -d moodle -At -F '=' -c "
    select e.element, v.value from mdl_scorm_scoes_value v
    join mdl_scorm_element e on e.id = v.elementid
    join mdl_scorm_attempt a on a.id = v.attemptid
    join mdl_scorm s on s.id = a.scormid
    where s.name = '$1' order by e.element"
}
expect() {
  echo "$2" | grep -qxF "$3" || { echo "FAIL: $1 has no $3. Moodle stored:" >&2; echo "$2" >&2; exit 1; }
}
T12=$(tracks 'Coursecraft SCORM 1.2')
expect 'SCORM 1.2' "$T12" 'cmi.core.lesson_status=passed'
expect 'SCORM 1.2' "$T12" 'cmi.core.score.raw=67'
expect 'SCORM 1.2' "$T12" 'cmi.interactions_2.result=wrong'
T2004=$(tracks 'Coursecraft SCORM 2004')
expect 'SCORM 2004' "$T2004" 'cmi.completion_status=completed'
expect 'SCORM 2004' "$T2004" 'cmi.success_status=passed'
expect 'SCORM 2004' "$T2004" 'cmi.score.scaled=0.6667'
expect 'SCORM 2004' "$T2004" 'cmi.interactions.2.result=incorrect'
echo "Moodle conformance test passed."
