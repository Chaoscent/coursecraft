// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { CURRENT_FORMAT_VERSION, courseSchema } from '../src/index.js';

const target = new URL(`../schema/course.v${CURRENT_FORMAT_VERSION}.schema.json`, import.meta.url);
const schema = {
  ...z.toJSONSchema(courseSchema, { io: 'input', unrepresentable: 'any', reused: 'ref' }),
  $id: `https://coursecraft.invalid/schema/course.v${CURRENT_FORMAT_VERSION}.json`,
  title: `Coursecraft course format v${CURRENT_FORMAT_VERSION}`,
};
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
