// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, rolesGrant } from './permissions.js';

describe('rolesGrant', () => {
  it('grants every permission to admins', () => {
    for (const permission of PERMISSIONS) {
      expect(rolesGrant(['admin'], permission)).toBe(true);
    }
  });

  it('keeps learners away from management permissions', () => {
    expect(rolesGrant(['learner'], 'users.manage')).toBe(false);
    expect(rolesGrant(['learner'], 'learning.participate')).toBe(true);
  });

  it('combines several roles', () => {
    expect(rolesGrant(['learner', 'author'], 'courses.author')).toBe(true);
  });

  it('grants nothing without roles', () => {
    expect(rolesGrant([], 'session.self')).toBe(false);
  });
});
