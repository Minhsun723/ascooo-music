import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from './api/client';
import { AuthGate, LoginPage, RequireUser } from './components/Auth';
import { setLoginGate } from './lib/login-gate';
import { Shell } from './components/Shell';
import {
  AlbumPage,
  ArtistPage,
  ArtistTracksPage,
  CopyrightPage,
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
  const navigate = useNavigate();
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(() => {});
  }, [setUser]);

  useEffect(() => {
    setLoginGate(() => {
      if (useSession.getState().user) return true;
      const { pathname, search, hash } = window.location;
      navigate('/login', { state: { from: pathname + search + hash } });
      return false;
    });
    return () => setLoginGate(() => true);
  }, [navigate]);

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
        <Route index element={<Navigate to="/discover" replace />} />
        <Route path="login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route path="discover" element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="favorites" element={<RequireUser><FavoritesPage /></RequireUser>} />
          <Route path="album/:id" element={<AlbumPage />} />
          <Route path="artist/:id" element={<ArtistPage />} />
          <Route path="artist/:id/tracks" element={<ArtistTracksPage />} />
          <Route path="playlist/:id" element={<RequireUser><PlaylistPage /></RequireUser>} />
          <Route path="settings" element={<RequireUser><SettingsPage /></RequireUser>} />
          <Route path="copyright" element={<CopyrightPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <ToastViewport />
    </AuthGate>
  );
}
