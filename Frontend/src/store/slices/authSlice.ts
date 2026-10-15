import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/lib/api';

export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** /me was unreachable (network/5xx/timeout) — the session is still unknown. */
  bootstrapError: boolean;
}

const initialState: AuthState = {
  status: 'unknown',
  user: null,
  bootstrapError: false,
};

/**
 * A cache of what the server said — never the authority. The session cookie
 * is httpOnly, so GET /auth/me re-establishes truth on every fresh load.
 */
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<User>) {
      state.status = 'authenticated';
      state.user = action.payload;
      state.bootstrapError = false;
    },
    setAnonymous(state) {
      state.status = 'anonymous';
      state.user = null;
      state.bootstrapError = false;
    },
    markLoading(state) {
      state.status = 'loading';
    },
    setBootstrapError(state, action: PayloadAction<boolean>) {
      state.bootstrapError = action.payload;
    },
  },
});

export const { setUser, setAnonymous, markLoading, setBootstrapError } =
  authSlice.actions;
export default authSlice.reducer;
