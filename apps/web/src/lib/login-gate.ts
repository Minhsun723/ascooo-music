import type { Track } from '../api/types';

/** What the visitor was trying to do, so the sign-in prompt can show it. */
export interface LoginPrompt {
  title?: string;
  track?: Pick<Track, 'title' | 'artist' | 'artworkId'>;
}

type LoginGate = (prompt?: LoginPrompt) => boolean;

let gate: LoginGate = () => true;

/** App registers the real check once the router is mounted. */
export const setLoginGate = (fn: LoginGate) => {
  gate = fn;
};

/** True when signed in; otherwise asks the visitor to sign in and returns false. */
export const requireLogin = (prompt?: LoginPrompt) => gate(prompt);
