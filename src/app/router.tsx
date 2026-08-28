import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PrivacyPage } from '@/pages/PrivacyPage'
import { SearchPage } from '@/pages/SearchPage'
import { SettingsPage } from '@/pages/SettingsPage'

/**
 * The reference is a single route with an in-place search swap. Production keeps
 * the identical visual states but gives search a real, shareable URL — which is
 * why `vercel.json` ships an SPA rewrite (docs/reference-route-map.md).
 */
export const routes = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'search', element: <SearchPage /> },
      // Phase 3: the disclosure agents/26 requires, on its own shareable URL.
      { path: 'privacy', element: <PrivacyPage /> },
      // Phase 4: the clear/reset controls STEP 16 asks for, kept off the home
      // page so a destructive action is never a stray click between shelves.
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
