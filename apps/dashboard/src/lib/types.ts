export type ConversationStatus = 'active' | 'awaiting_handoff' | 'assigned' | 'closed';

export interface Patient {
  id: string;
  phone: string;
  name: string | null;
  profile: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'human';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  tenantId: string;
  status: ConversationStatus;
  assignedToUserId: string | null;
  lastMessageAt: string;
  aiPausedUntil?: string | null;
  createdAt: string;
  patient: Patient;
  assignedTo?: { id: string; name: string; email: string } | null;
  messages: Message[];
  handoffs?: Array<{ id: string; status: string; summary: string; createdAt: string }>;
}

export interface Vaccine {
  id: string;
  name: string;
  slug: string;
  description: string;
  ageMonths: number[];
  priceCash: number;
  priceInstallment: number;
  installments: number;
  active: boolean;
  inStock?: boolean;
  outOfStockNote?: string | null;
}

export interface VaccinePackage {
  id: string;
  name: string;
  slug: string;
  description: string;
  items: Array<{ vaccineSlug: string; doses: number }>;
  priceCash: number;
  priceInstallment: number;
  installments: number;
  active: boolean;
}

export interface KBDocumentSummary {
  id: string;
  title: string;
  source: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
  _count?: { chunks: number };
}

export interface KBDocument extends Omit<KBDocumentSummary, '_count'> {
  content: string;
}

export interface MetricsOverview {
  active: number;
  awaitingHandoff: number;
  assignedActive: number;
  closedToday: number;
  messagesToday: number;
  handoffsToday?: number;
  patientsToday?: number;
  aiMessagesToday?: number;
}

export interface HourlyPoint {
  hour: number;
  messages: number;
}

export interface MessagesBreakdown {
  user: number;
  assistant: number;
  human: number;
}

export interface WeeklyPoint {
  date: string;
  messages: number;
  handoffs: number;
}

export interface TenantSettings {
  id: string;
  name: string;
  phone: string | null;
  config: {
    persona?: string;
    greeting?: string;
    businessHours?: { start: string; end: string; timezone: string };
    silentHours?: { enabled: boolean; start: string; end: string; offlineMessage?: string };
    quickTemplates?: Array<{ label: string; text: string }>;
    reminders?: {
      enabled: boolean;
      leadTimesMinutes: number[];
      messageTemplate?: string;
    };
  };
}

export interface PatientSummary {
  id: string;
  phone: string;
  name: string | null;
  profile: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  _count?: { conversations: number; vaccinations: number };
}

export interface PatientVaccination {
  id: string;
  vaccineSlug: string;
  dose: number;
  appliedAt: string;
  nextDueAt: string | null;
  notes: string | null;
  vaccine?: { name: string; slug: string } | null;
}

export interface Reminder {
  id: string;
  vaccineSlug: string;
  dose: number;
  scheduledFor: string;
  message: string;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  sentAt: string | null;
}

export interface PatientDetail extends PatientSummary {
  vaccinations: PatientVaccination[];
  reminders: Reminder[];
  conversations: Array<{ id: string; status: string; lastMessageAt: string; createdAt: string }>;
}

export type CampaignAudience = 'all' | 'baby_below_12m' | 'missing_next_dose' | 'custom';
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'failed';

export interface Campaign {
  id: string;
  name: string;
  message: string;
  audience: CampaignAudience;
  audienceFilter: Record<string, unknown>;
  status: CampaignStatus;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  totalTargets: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'attendant';
  active: boolean;
  createdAt: string;
}

export type AppointmentStatus = 'scheduled' | 'attended' | 'no_show' | 'paid' | 'cancelled';

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  conversationId: string | null;
  scheduledFor: string;
  status: AppointmentStatus;
  vaccineSlugs: string[];
  expectedValue: number | null;
  paidValue: number | null;
  notes: string | null;
  createdAt: string;
  patient?: { id: string; name: string | null; phone: string };
}

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
}

export interface FunnelData {
  days: number;
  steps: FunnelStep[];
  revenue: number;
  conversion: number;
}
