import {
  BookOpen,
  LayoutDashboard,
  LineChart,
  ListTodo,
  Megaphone,
  Settings,
  Syringe,
  Users,
  UserRound,
} from 'lucide-react';

export type AppRole = 'admin' | 'attendant' | 'secretary';

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles autorizados a ver esse item. undefined = todos. */
  roles?: AppRole[];
};

export const navItems: NavItem[] = [
  { href: '/queue', label: 'Fila', icon: ListTodo },
  { href: '/patients', label: 'Pacientes', icon: UserRound },
  { href: '/metrics', label: 'Métricas', icon: LineChart, roles: ['admin', 'attendant'] },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone, roles: ['admin', 'secretary'] },
  { href: '/vaccines', label: 'Vacinas', icon: Syringe },
  { href: '/kb', label: 'Base de conhecimento', icon: BookOpen, roles: ['admin', 'attendant'] },
  { href: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
  { href: '/settings', label: 'Configurações', icon: Settings, roles: ['admin', 'secretary'] },
];

/** Helper para filtrar itens conforme o role do usuário logado. */
export function filterNavForRole(role: string): NavItem[] {
  return navItems.filter((item) => !item.roles || item.roles.includes(role as AppRole));
}
