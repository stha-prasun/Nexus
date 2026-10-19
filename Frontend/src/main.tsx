import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router/dom';
import { LoadingBarContainer } from 'react-top-loading-bar';
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
      <LoadingBarContainer
        props={{ color: '#1f2fe0', height: 3, shadow: false }}
      >
        <SessionGate>
          <RouterProvider router={router} />
        </SessionGate>
      </LoadingBarContainer>
    </Provider>
  </StrictMode>,
);
