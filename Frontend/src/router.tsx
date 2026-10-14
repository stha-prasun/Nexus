import { createBrowserRouter } from 'react-router';
import { RootLayout } from '@/layouts/RootLayout';
import { ConfirmSentPage } from '@/pages/ConfirmSentPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
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
    Component: RootLayout,
    children: [
      {
        path: '*',
        Component: NotFoundPage,
      },
    ],
  },
]);
