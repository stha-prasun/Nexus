import { createBrowserRouter } from 'react-router';
import { RootLayout } from '@/layouts/RootLayout';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SignupPage } from '@/pages/SignupPage';

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
    Component: RootLayout,
    children: [
      {
        path: '*',
        Component: NotFoundPage,
      },
    ],
  },
]);
