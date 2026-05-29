import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default async function HomePage(): Promise<never> {
  const user = await getCurrentUser();
  // Sem sessao: vai pro login (que ja envia pra rota certa apos autenticar)
  if (!user) redirect('/login');
  // Secretaria nao ve metricas; cai na Fila (visao operacional)
  if (user.role === 'secretary') redirect('/queue');
  redirect('/metrics');
}
