type LoginGate = () => boolean;

let gate: LoginGate = () => true;

/** App registers the real check once the router is mounted. */
export const setLoginGate = (fn: LoginGate) => {
  gate = fn;
};

/** True when signed in; otherwise sends the visitor to the login page and returns false. */
export const requireLogin = () => gate();
