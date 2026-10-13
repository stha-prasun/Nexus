import { createBrowserRouter } from 'react-router';
import { RootLayout } from '@/layouts/RootLayout';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    index: true,
    Component: LoginPage,
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
