// SPDX-License-Identifier: Apache-2.0
import type { Permission } from '@coursecraft/shared';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { SessionProvider, useSession } from '../api/session.js';
import { AppShell } from '../layout/AppShell.js';
import { ChangePasswordPage } from '../pages/ChangePasswordPage.js';
import { HomePage } from '../pages/HomePage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { ResetPasswordPage } from '../pages/ResetPasswordPage.js';
import { SetupPage } from '../pages/SetupPage.js';
import { PlayerPage } from '../pages/PlayerPage.js';

/**
 * Pages that not everybody needs load on demand, so learners do not download the editor
 * and the administration. The shell stays on screen while a chunk arrives.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType {
  return lazy(async () => {
    const loaded = await load();
    const component: ComponentType = loaded[name];
    return { default: component };
  });
}
const AccountPage = lazyPage(() => import('../pages/AccountPage.js'), 'AccountPage');
const AiPage = lazyPage(() => import('../pages/AiPage.js'), 'AiPage');
const AuditPage = lazyPage(() => import('../pages/AuditPage.js'), 'AuditPage');
const EditorPage = lazyPage(() => import('../editor/EditorPage.js'), 'EditorPage');
const CoursesPage = lazyPage(() => import('../pages/CoursesPage.js'), 'CoursesPage');
const GroupsPage = lazyPage(() => import('../pages/GroupsPage.js'), 'GroupsPage');
const MailPage = lazyPage(() => import('../pages/MailPage.js'), 'MailPage');
const SsoPage = lazyPage(() => import('../pages/SsoPage.js'), 'SsoPage');
const UsersPage = lazyPage(() => import('../pages/UsersPage.js'), 'UsersPage');
const GradingPage = lazyPage(() => import('../pages/GradingPage.js'), 'GradingPage');
const LibraryPage = lazyPage(() => import('../pages/LibraryPage.js'), 'LibraryPage');
const PathsPage = lazyPage(() => import('../pages/PathsPage.js'), 'PathsPage');
const ReportPage = lazyPage(() => import('../pages/ReportPage.js'), 'ReportPage');

function Later({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

/** Full-window pages (editor) outside the application shell. */
function RequireStandalone({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { session, setupRequired, can } = useSession();
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.mustChangePassword) return <ChangePasswordPage />;
  return can(permission) ? children : <Navigate to="/" replace />;
}

function RequireSession() {
  const { session, setupRequired } = useSession();
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.mustChangePassword) return <ChangePasswordPage />;
  return <AppShell />;
}

/** Hides pages the user may not use; the server enforces the same rule. */
function Allowed({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useSession();
  return can(permission) ? children : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    path: '/author/courses/:id',
    element: (
      <RequireStandalone permission="courses.author">
        <Later>
          <EditorPage />
        </Later>
      </RequireStandalone>
    ),
  },
  {
    path: '/learn/:id',
    element: (
      <RequireStandalone permission="learning.participate">
        <PlayerPage />
      </RequireStandalone>
    ),
  },
  {
    path: '/',
    element: <RequireSession />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'account',
        element: (
          <Later>
            <AccountPage />
          </Later>
        ),
      },
      {
        path: 'author',
        element: (
          <Allowed permission="courses.author">
            <Later>
              <CoursesPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'library',
        element: (
          <Allowed permission="library.view">
            <Later>
              <LibraryPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'paths',
        element: (
          <Allowed permission="library.view">
            <Later>
              <PathsPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'library/:id/report',
        element: (
          <Allowed permission="reports.read">
            <Later>
              <ReportPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'grading',
        element: (
          <Allowed permission="grading.perform">
            <Later>
              <GradingPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <Allowed permission="users.manage">
            <Later>
              <UsersPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/groups',
        element: (
          <Allowed permission="groups.manage">
            <Later>
              <GroupsPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/sso',
        element: (
          <Allowed permission="settings.manage">
            <Later>
              <SsoPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/mail',
        element: (
          <Allowed permission="settings.manage">
            <Later>
              <MailPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/ai',
        element: (
          <Allowed permission="settings.manage">
            <Later>
              <AiPage />
            </Later>
          </Allowed>
        ),
      },
      {
        path: 'admin/audit',
        element: (
          <Allowed permission="audit.read">
            <Later>
              <AuditPage />
            </Later>
          </Allowed>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

function Gate() {
  const { loading } = useSession();
  if (loading) return null;
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
