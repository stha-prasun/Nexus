import { createBrowserRouter } from 'react-router';
import { RootLayout } from '@/layouts/RootLayout';
import { ConfirmSentPage } from '@/pages/ConfirmSentPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { SignupPage } from '@/pages/SignupPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';

export const router = createBrowserRouter([
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
    path: 'dashboard',
    Component: DashboardPage,
  },
  {
    path: 'profile',
    Component: ProfilePage,
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
]);
