import { UserAccount } from '../types';

const AUTH_USER_KEY = 'ai_inventory_current_user_v1';
const REGISTERED_USERS_KEY = 'ai_inventory_registered_users_v1';

export const DEFAULT_USERS: Array<UserAccount & { password?: string }> = [];

export const PREDEFINED_TEAMS = [
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

  private getRegisteredUsers(): Array<UserAccount & { password?: string }> {
    try {
      const data = localStorage.getItem(REGISTERED_USERS_KEY);
      if (data) {
        const users = JSON.parse(data) as Array<UserAccount & { password?: string }>;
        const demoUserIds = new Set(['john_smith', 'tariq_mansour', 'sarah_jenkins', 'aminah01']);
        const cleaned = users.filter((u) => !demoUserIds.has(u.userId.toLowerCase()));
        if (cleaned.length !== users.length) {
          localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    } catch (e) {
      console.warn('[AuthService] Error reading registered users:', e);
    }
    return [];
  }

  private loadStoredUser(): UserAccount | null {
    try {
      const data = localStorage.getItem(AUTH_USER_KEY);
      if (data) {
        const user = JSON.parse(data) as UserAccount;
        const demoUserIds = new Set(['john_smith', 'tariq_mansour', 'sarah_jenkins', 'aminah01']);
        if (demoUserIds.has(user.userId.toLowerCase())) {
          localStorage.removeItem(AUTH_USER_KEY);
          return null;
        }
        return user;
      }
    } catch (e) {
      console.warn('[AuthService] Error loading stored auth user:', e);
    }
    // Return null so unauthenticated users see the Login and Registration screen first
    return null;
  }

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

  public async login(userId: string, password?: string): Promise<{ success: boolean; message?: string; user?: UserAccount }> {
    const trimmedId = userId.trim().toLowerCase();

    // 1. Attempt Server-Side Flask/Express Authentication first
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: trimmedId, password: password || 'password123' }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          localStorage.setItem('session_token', data.token);
        }
        const serverUser = data.user;
        const userAccount: UserAccount = {
          id: `usr-${serverUser.userId}`,
          userId: serverUser.userId,
          userName: serverUser.fullName || serverUser.userId,
          teamName: serverUser.team || 'Warehouse Team A',
          role: 'Store Officer',
          createdAt: new Date().toISOString().slice(0, 10),
        };
        this.currentUser = userAccount;
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userAccount));
        this.notify();
        return { success: true, user: userAccount };
      } else if (response.status === 401) {
        const errData = await response.json().catch(() => ({}));
        return { success: false, message: errData.error || 'Invalid User ID or password.' };
      }
    } catch (e) {
      console.warn('[AuthService] Server API unavailable, using local authentication:', e);
    }

    // 2. Client-Side fallback for offline mode
    const allUsers = this.getRegisteredUsers();
    const matched = allUsers.find(
      (u) => u.userId.toLowerCase() === trimmedId || u.userName.toLowerCase() === trimmedId
    );

    if (!matched) {
      return { success: false, message: 'User ID not found. Please verify your credentials or register.' };
    }

    if (matched.password && password && matched.password !== password) {
      return { success: false, message: 'Invalid password. Please check your password.' };
    }

    const { password: _, ...cleanUser } = matched;
    this.currentUser = cleanUser;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(cleanUser));
    this.notify();
    return { success: true, user: cleanUser };
  }

  public async signUp(data: {
    userId: string;
    userName?: string;
    teamName: string;
    password?: string;
  }): Promise<{ success: boolean; message?: string; user?: UserAccount }> {
    const trimmedId = data.userId.trim().toLowerCase();
    if (!trimmedId) {
      return { success: false, message: 'User ID is required.' };
    }
    if (!data.teamName.trim()) {
      return { success: false, message: 'Team Name is required.' };
    }

    const formattedName =
      data.userName?.trim() ||
      trimmedId
        .split(/[._-]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');

    // 1. Attempt Server-Side Registration
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: trimmedId,
          password: data.password || 'password123',
          fullName: formattedName,
          team: data.teamName.trim(),
        }),
      });

      if (response.status === 409) {
        return { success: false, message: 'User ID already exists in system. Please select another.' };
      }
    } catch (e) {
      console.warn('[AuthService] Server registration unavailable, registering locally:', e);
    }

    // 2. Client-Side Store Synchronization
    const allUsers = this.getRegisteredUsers();
    if (allUsers.some((u) => u.userId.toLowerCase() === trimmedId)) {
      return { success: false, message: 'This User ID is already taken. Please choose another.' };
    }

    const newUser: UserAccount & { password?: string } = {
      id: `usr-${Date.now()}`,
      userId: trimmedId,
      userName: formattedName,
      teamName: data.teamName.trim(),
      role: 'Store Officer',
      password: data.password || 'password123',
      createdAt: new Date().toISOString().slice(0, 10),
    };

    allUsers.push(newUser);
    localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(allUsers));

    const { password: _, ...cleanUser } = newUser;
    this.currentUser = cleanUser;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(cleanUser));
    this.notify();

    return { success: true, user: cleanUser };
  }

  public async logout(): Promise<void> {
    try {
      const token = localStorage.getItem('session_token');
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (e) {
      console.warn('[AuthService] Logout API request failed:', e);
    }
    localStorage.removeItem('session_token');
    this.currentUser = null;
    localStorage.removeItem(AUTH_USER_KEY);
    this.notify();
  }
}

export const authService = new AuthService();
