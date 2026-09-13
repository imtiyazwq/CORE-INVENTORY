import { UserAccount } from '../types';

export const PREDEFINED_TEAMS = [
  'Warehouse Team A',
  'Warehouse Team B',
  'Logistics & Operations',
  'Laboratory & Chemical Staff',
  'IT Support & Hardware',
  'Quality Assurance',
  'General Operations',
];

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE}${path}`;

class AuthService {
  private currentUser: UserAccount | null = null;

  public getCurrentUser(): UserAccount | null {
    return this.currentUser;
  }

  public async restoreSession(): Promise<UserAccount | null> {
    try {
      const response = await fetch(apiUrl('/api/me'), { credentials: 'include' });
      if (!response.ok) {
        this.currentUser = null;
        return null;
      }
      const data = await response.json();
      if (!data.authenticated) {
        this.currentUser = null;
        return null;
      }
      this.currentUser = {
        userId: data.userId,
        userName: data.fullName || data.userId,
        teamName: data.team,
      };
      return this.currentUser;
    } catch (error) {
      console.error('[AuthService] Session restore failed:', error);
      this.currentUser = null;
      return null;
    }
  }

  public async login(userId: string, password?: string): Promise<{ success: boolean; user?: UserAccount; message?: string }> {
    const cleanId = userId.trim();
    if (!cleanId) return { success: false, message: 'User ID is required.' };
    if (!password) return { success: false, message: 'Password is required.' };

    try {
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: cleanId, password }),
      });
      const data = await response.json();
      if (!response.ok) return { success: false, message: data.error || 'Invalid User ID or password.' };

      const user: UserAccount = {
        userId: data.user.userId,
        userName: data.user.fullName || data.user.userId,
        teamName: data.user.team,
      };
      this.currentUser = user;
      return { success: true, user };
    } catch (error) {
      console.error('[AuthService] Login failed:', error);
      return { success: false, message: 'Cannot reach the CORE INVENTORY server. Please try again.' };
    }
  }

  public async signUp(data: { userId: string; teamName: string; password?: string }): Promise<{ success: boolean; user?: UserAccount; message?: string }> {
    const cleanId = data.userId.trim();
    if (!cleanId) return { success: false, message: 'User ID is required.' };
    if (!data.password) return { success: false, message: 'Password is required.' };
    if (!data.teamName?.trim()) return { success: false, message: 'Team Name is required.' };

    try {
      const response = await fetch(apiUrl('/api/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: cleanId, password: data.password, fullName: cleanId, team: data.teamName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) return { success: false, message: result.error || 'Registration failed.' };

      const user: UserAccount = {
        userId: result.user.userId,
        userName: result.user.fullName || result.user.userId,
        teamName: result.user.team,
      };
      this.currentUser = user;
      return { success: true, user };
    } catch (error) {
      console.error('[AuthService] Registration failed:', error);
      return { success: false, message: 'Cannot reach the CORE INVENTORY server. Please try again.' };
    }
  }

  public async logout(): Promise<void> {
    try {
      await fetch(apiUrl('/api/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      this.currentUser = null;
    }
  }
}

export const authService = new AuthService();
