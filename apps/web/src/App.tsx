import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { setUnauthorizedHandler } from './api/client';
import { AuthGate } from './components/Auth';
import { Shell } from './components/Shell';
import {
  AlbumPage,
  ArtistPage,
  FavoritesPage,
  HomePage,
  LibraryPage,
  NotFoundPage,
  PlaylistPage,
  SearchPage,
  SettingsPage,
} from './pages';
import { useSession } from './store/session';
import { useToasts } from './store/toast';

function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => <button type="button" className={`toast toast--${toast.kind}`} key={toast.id} onClick={() => dismiss(toast.id)}>{toast.message}</button>)}
    </div>
  );
}

export default function App() {
  const setUser = useSession((s) => s.setUser);
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(() => {});
  }, [setUser]);

  useEffect(() => {
    const preventImageInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('img')) event.preventDefault();
    };

    document.addEventListener('dragstart', preventImageInteraction, true);
    document.addEventListener('contextmenu', preventImageInteraction, true);
    return () => {
      document.removeEventListener('dragstart', preventImageInteraction, true);
      document.removeEventListener('contextmenu', preventImageInteraction, true);
    };
  }, []);

  return (
    <AuthGate>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="album/:id" element={<AlbumPage />} />
          <Route path="artist/:id" element={<ArtistPage />} />
          <Route path="playlist/:id" element={<PlaylistPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <ToastViewport />
    </AuthGate>
  );
}
