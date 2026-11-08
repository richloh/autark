import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { installMockServer } from '@/mock/server';
import { queryClient } from '@/api/hooks';
import { router } from '@/routes';
import './index.css';

// Boot the in-browser mock control plane (intercepts fetch('/api/v1/...')).
installMockServer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
