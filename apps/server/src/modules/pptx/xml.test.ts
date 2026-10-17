// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseXml } from './xml.js';

describe('parseXml', () => {
  it('refuses documents with a DTD (entity expansion)', () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>';
    expect(() => parseXml(Buffer.from(xml))).toThrow(/document type/);
  });

  it('refuses malformed XML', () => {
    expect(() => parseXml(Buffer.from('<a><b></a>'))).toThrow();
  });

  it('parses namespaced XML', () => {
    expect(parseXml(Buffer.from('<x:a xmlns:x="urn:x"><x:b/></x:a>')).documentElement?.localName).toBe('a');
  });
});
