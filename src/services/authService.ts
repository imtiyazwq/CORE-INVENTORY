import { UserAccount } from '../types';

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
      const response = await fetch('/api/login', {
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
   * Logout via Flask /api/logout endpoint.
   * Always clears local session regardless of server response.
   */
  public async logout(): Promise<void> {
    try {
      await fetch('/api/logout', {
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
