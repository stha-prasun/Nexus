import { createBrowserRouter } from 'react-router';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ProgressLayout } from '@/layouts/ProgressLayout';
import { RootLayout } from '@/layouts/RootLayout';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { ConfirmSentPage } from '@/pages/ConfirmSentPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ProjectBoardPage } from '@/pages/ProjectBoardPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { ProjectDocumentsPage } from '@/pages/ProjectDocumentsPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { SignupPage } from '@/pages/SignupPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';

export const router = createBrowserRouter([
  {
    // Pathless: every route nests under it so TopLoadingBar can observe
    // navigation state without changing any URL.
    Component: ProgressLayout,
    children: [
      {
        index: true,
        Component: LoginPage,
      },
      {
        path: 'signup',
        Component: SignupPage,
      },
      {
        path: 'confirm-sent',
        Component: ConfirmSentPage,
      },
      {
        path: 'verify-email',
        Component: VerifyEmailPage,
      },
      {
        // Public: the page itself handles anonymous / wrong-account / unverified
        // states (the token is the capability) — no RequireAuth bounce.
        path: 'accept-invite',
        Component: AcceptInvitePage,
      },
      {
        path: 'dashboard',
        element: (
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard/projects',
        element: (
          <RequireAuth>
            <ProjectsPage />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard/projects/:id',
        element: (
          <RequireAuth>
            <ProjectDetailPage />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard/projects/:id/board',
        element: (
          <RequireAuth>
            <ProjectBoardPage />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard/projects/:id/documents',
        element: (
          <RequireAuth>
            <ProjectDocumentsPage />
          </RequireAuth>
        ),
      },
      {
        path: 'profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        Component: RootLayout,
        children: [
          {
            path: '*',
            Component: NotFoundPage,
          },
        ],
      },
    ],
  },
]);
