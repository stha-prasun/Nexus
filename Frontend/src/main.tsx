import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router/dom';
import { SessionGate } from '@/components/auth/SessionGate';
import { router } from '@/router';
import { store } from '@/store';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
    </Provider>
  </StrictMode>,
);
