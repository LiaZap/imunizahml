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

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  { href: '/queue', label: 'Fila', icon: ListTodo },
  { href: '/patients', label: 'Pacientes', icon: UserRound },
  { href: '/metrics', label: 'Métricas', icon: LineChart },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone, adminOnly: true },
  { href: '/vaccines', label: 'Vacinas', icon: Syringe },
  { href: '/kb', label: 'Base de conhecimento', icon: BookOpen },
  { href: '/users', label: 'Usuários', icon: Users, adminOnly: true },
  { href: '/settings', label: 'Configurações', icon: Settings, adminOnly: true },
];
