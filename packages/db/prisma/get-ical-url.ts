/**
 * Gera (se nao existir) e imprime o link iCal do tenant.
 * Use pra copiar o URL que vai no Google Agenda da clinica.
 *
 *   cd /app/packages/db && pnpm exec tsx prisma/get-ical-url.ts
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'clinica-imuniza' } });
  if (!tenant) {
    console.error('Tenant clinica-imuniza nao encontrado.');
    process.exit(1);
  }

  let token = (tenant.config as { icalToken?: string } | null)?.icalToken;
  if (!token) {
    token = crypto.randomBytes(20).toString('hex');
    const cfg = (tenant.config as Record<string, unknown>) ?? {};
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { config: { ...cfg, icalToken: token } as Prisma.InputJsonValue },
    });
    console.log('Token gerado e salvo.');
  } else {
    console.log('Token ja existente.');
  }

  const base = process.env.API_BASE_URL ?? 'https://conectiva-bot-imunizaapi.cusrzj.easypanel.host';
  const url = `${base}/calendar/${tenant.slug}/${token}/calendar.ics`;
  console.log('\n📅 Link iCal da clinica:\n');
  console.log(url);
  console.log('\nCole este link no Google Agenda → "Outras agendas" → "+" → "Inscrever-se via URL"');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
