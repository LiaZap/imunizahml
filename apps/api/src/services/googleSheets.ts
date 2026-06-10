/**
 * Integração com Google Sheets via OAuth 2.0 (reutiliza o refresh_token
 * que ja existe pra Calendar — basta o scope `spreadsheets.readonly`).
 *
 * Pra ativar em prod:
 *   1. Cliente desconecta o Google em /settings
 *   2. Reconecta — a consent screen pede o scope novo
 *   3. Cola o ID da planilha no campo proprio
 *   4. Botao "Sincronizar agora" → roda vaccineSyncFromSheet
 */
import { google, type sheets_v4 } from 'googleapis';
import { prisma, Prisma } from '@imuniza/db';
import { env } from '../env.js';
import { loadGoogleConfig } from './googleCalendar.js';

export interface GoogleSheetsConfig {
  /** ID da planilha (entre /d/ e /edit na URL do Google Sheets). */
  spreadsheetId: string;
  /** Aba/range opcional, ex: "Vacinas!A:Z". Se vazio, usa a primeira aba inteira. */
  range?: string;
  /** ISO timestamp do último sync bem-sucedido. */
  lastSyncAt?: string;
  /** Quantas vacinas foram afetadas no último sync. */
  lastSyncCount?: number;
}

function newOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

function buildSheetsClient(refreshToken: string): sheets_v4.Sheets {
  const client = newOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: 'v4', auth: client });
}

export async function loadSheetsConfig(tenantId: string): Promise<GoogleSheetsConfig | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { config: true },
  });
  const cfg = (tenant?.config as { googleSheets?: GoogleSheetsConfig } | null)?.googleSheets;
  return cfg ?? null;
}

export async function saveSheetsConfig(
  tenantId: string,
  config: GoogleSheetsConfig,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('tenant not found');
  const cfg = (tenant.config as Record<string, unknown>) ?? {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { config: { ...cfg, googleSheets: { ...config } } as Prisma.InputJsonValue },
  });
}

/** Lê todas as linhas/colunas de uma planilha (range opcional). */
export async function readSheet(
  tenantId: string,
  spreadsheetId: string,
  range?: string,
): Promise<string[][]> {
  const cfg = await loadGoogleConfig(tenantId);
  if (!cfg) throw new Error('Google não conectado — conecta primeiro em /settings');

  const sheets = buildSheetsClient(cfg.refreshToken);
  // Sem range → pega a primeira sheet inteira
  let effectiveRange = range;
  if (!effectiveRange) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const firstSheet = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
    effectiveRange = `${firstSheet}!A:Z`;
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: effectiveRange,
  });
  return (res.data.values as string[][]) ?? [];
}
