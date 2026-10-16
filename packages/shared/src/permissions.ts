// SPDX-License-Identifier: Apache-2.0
import type { Role } from './roles.js';

/**
 * Coarse, role-level permissions checked by the route layer. Resource-level
 * rules (ownership, group membership) live in the server's policy module.
 */
export const PERMISSIONS = [
  'system.health',
  'session.self',
  'users.manage',
  'groups.manage',
  'settings.manage',
  'audit.read',
  'courses.author',
  'library.manage',
  'assignments.manage',
  'reports.read',
  'grading.perform',
  'learning.participate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Routes must name a permission or explicitly opt out with `public`. */
export type RoutePermission = Permission | 'public';

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: PERMISSIONS,
  author: ['session.self', 'courses.author', 'learning.participate'],
  trainer: ['session.self', 'assignments.manage', 'reports.read', 'grading.perform', 'learning.participate'],
  learner: ['session.self', 'learning.participate'],
};

export function rolesGrant(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}
