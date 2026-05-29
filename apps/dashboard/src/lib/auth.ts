import { redirect } from 'next/navigation';
import { apiGet } from './api-server';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'attendant' | 'secretary';
  tenantId: string;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const data = await apiGet<{ user: SessionUser | null }>('/auth/me');
  return data?.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
