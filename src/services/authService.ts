import { UserAccount } from '../types';
import { API_BASE_URL } from './apiConfig';

const AUTH_USER_KEY = 'core_inventory_current_user_v2';

export const PREDEFINED_TEAMS = [
  'IT',
  'Warehouse Team A',
  'Electronics Store Ops',
  'ChemStore Ops',
  'Engineering Lab',
  'Central Logistics Ops',
  'STEM Faculty Supply',
] as const;

type AuthSubscriber = (user: UserAccount | null) => void;

class AuthService {
  private currentUser: UserAccount | null = null;
  private subscribers: Set<AuthSubscriber> = new Set();

  constructor() {
    this.currentUser = this.loadStoredUser();
  }

  // ---------------------------------------------------------------------------
  // Session persistence (localStorage cache for offline resilience)
  // ---------------------------------------------------------------------------

  private loadStoredUser(): UserAccount | null {
    try {
      const data = localStorage.getItem(AUTH_USER_KEY);
      if (data) {
        return JSON.parse(data) as UserAccount;
      }
    } catch (e) {
      console.warn('[AuthService] Error loading stored user:', e);
    }
    return null;
  }

  private saveUser(user: UserAccount | null): void {
    if (user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_USER_KEY);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public getCurrentUser(): UserAccount | null {
    return this.currentUser;
  }

  public isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  public subscribe(callback: AuthSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.currentUser);
    return () => this.subscribers.delete(callback);
  }

  private notify(): void {
    const user = this.currentUser ? { ...this.currentUser } : null;
    this.subscribers.forEach((cb) => cb(user));
  }

  /**
   * Login via Flask /api/login endpoint.
   * On success the server sets an HTTP session cookie.
   * We cache the user object locally for offline resilience.
   */
  public async login(
    userId: string,
    password: string,
  ): Promise<{ success: boolean; message?: string; user?: UserAccount }> {
    const trimmedId = userId.trim().toLowerCase();

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // send/receive session cookie
        body: JSON.stringify({ userId: trimmedId, password }),
      });

      if (response.ok) {
        const data = await response.json();
        const serverUser = data.user;

        const userAccount: UserAccount = {
          id:       `usr-${serverUser.userId}`,
          userId:   serverUser.userId,
          userName: serverUser.fullName || serverUser.userId,
          teamName: serverUser.team || 'IT',
          role:     serverUser.role || 'Staff',
          createdAt: new Date().toISOString().slice(0, 10),
        };

        this.currentUser = userAccount;
        this.saveUser(userAccount);
        this.notify();
        return { success: true, user: userAccount };
      }

      // 401 or other error from server
      const errData = await response.json().catch(() => ({}));
      return { success: false, message: errData.error || 'Invalid user ID or password.' };

    } catch (networkError) {
      console.warn('[AuthService] Server unreachable during login:', networkError);

      // Offline fallback: restore from localStorage cache if available
      const cached = this.loadStoredUser();
      if (cached && cached.userId === trimmedId) {
        this.currentUser = cached;
        this.notify();
        return { success: true, user: cached };
      }
      return {
        success: false,
        message: 'Cannot reach server. Please check your connection.',
      };
    }
  }

  /**
   * Register via Flask /api/register endpoint (open registration — see
   * PROJECT_STATUS.md for the tradeoff this carries). New accounts are
   * always created server-side with role 'Staff'.
   *
   * AuthPage.tsx's signup form doesn't collect a separate "full name" field,
   * so one is derived from the userId (e.g. "aina_07" -> "Aina 07") unless
   * userName is explicitly given.
   *
   * Registration alone doesn't establish a Flask session — immediately
   * calls login() with the same credentials afterward so the user isn't
   * asked to sign in a second time.
   */
  public async signUp(data: {
    userId: string;
    userName?: string;
    teamName: string;
    password: string;
  }): Promise<{ success: boolean; message?: string; user?: UserAccount }> {
    const trimmedId = data.userId.trim().toLowerCase();
    if (!trimmedId) {
      return { success: false, message: 'User ID is required.' };
    }
    if (!data.teamName.trim()) {
      return { success: false, message: 'Team Name is required.' };
    }
    if (!data.password) {
      return { success: false, message: 'Password is required.' };
    }

    const formattedName =
      data.userName?.trim() ||
      trimmedId
        .split(/[._-]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');

    try {
      const response = await fetch(`${API_BASE_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: trimmedId,
          password: data.password,
          fullName: formattedName,
          team: data.teamName.trim(),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return { success: false, message: errData.error || 'Registration failed.' };
      }

      return await this.login(trimmedId, data.password);
    } catch (networkError) {
      console.warn('[AuthService] Server unreachable during registration:', networkError);
      return {
        success: false,
        message: 'Cannot reach server. Please check your connection.',
      };
    }
  }

  /**
   * Logout via Flask /api/logout endpoint.
   * Always clears local session regardless of server response.
   */
  public async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/api/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {
      console.warn('[AuthService] Logout request failed (offline?):', e);
    }

    this.currentUser = null;
    this.saveUser(null);
    this.notify();
  }
}

export const authService = new AuthService();
