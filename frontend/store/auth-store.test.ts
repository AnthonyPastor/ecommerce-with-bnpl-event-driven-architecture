import { useAuthStore } from './auth-store';

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  });

  it('starts with no session', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it('setAuth stores tokens and user', () => {
    useAuthStore
      .getState()
      .setAuth(
        { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        { id: '1', email: 'a@b.com', name: 'Ana' },
      );

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('a');
    expect(state.refreshToken).toBe('r');
    expect(state.user).toEqual({ id: '1', email: 'a@b.com', name: 'Ana' });
  });

  it('clearAuth resets the session', () => {
    useAuthStore
      .getState()
      .setAuth(
        { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        { id: '1', email: 'a@b.com', name: 'Ana' },
      );
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
  });
});
