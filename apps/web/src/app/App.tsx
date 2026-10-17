// SPDX-License-Identifier: Apache-2.0
import type { Permission } from '@lernwerk/shared';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { SessionProvider, useSession } from '../api/session.js';
import { AppShell } from '../layout/AppShell.js';
import { AccountPage } from '../pages/AccountPage.js';
import { AuditPage } from '../pages/AuditPage.js';
import { EditorPage } from '../editor/EditorPage.js';
import { ChangePasswordPage } from '../pages/ChangePasswordPage.js';
import { CoursesPage } from '../pages/CoursesPage.js';
import { GroupsPage } from '../pages/GroupsPage.js';
import { HomePage } from '../pages/HomePage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { SetupPage } from '../pages/SetupPage.js';
import { UsersPage } from '../pages/UsersPage.js';

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
  {
    path: '/author/courses/:id',
    element: (
      <RequireStandalone permission="courses.author">
        <EditorPage />
      </RequireStandalone>
    ),
  },
  {
    path: '/',
    element: <RequireSession />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'author',
        element: (
          <Allowed permission="courses.author">
            <CoursesPage />
          </Allowed>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <Allowed permission="users.manage">
            <UsersPage />
          </Allowed>
        ),
      },
      {
        path: 'admin/groups',
        element: (
          <Allowed permission="groups.manage">
            <GroupsPage />
          </Allowed>
        ),
      },
      {
        path: 'admin/audit',
        element: (
          <Allowed permission="audit.read">
            <AuditPage />
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
