import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { conversationsRoutes } from './routes/conversations.js';
import { metricsRoutes } from './routes/metrics.js';
import { kbRoutes } from './routes/kb.js';
import { eventsRoutes } from './routes/events.js';
import { authRoutes } from './routes/auth.js';
import { vaccinesRoutes } from './routes/vaccines.js';
import { settingsRoutes } from './routes/settings.js';
import { patientsRoutes } from './routes/patients.js';
import { campaignsRoutes } from './routes/campaigns.js';
import { usersRoutes } from './routes/users.js';
import { reportsRoutes } from './routes/reports.js';
import { appointmentsRoutes } from './routes/appointments.js';
import { instanceRoutes } from './routes/instance.js';
import { publicCalendarRoutes, adminCalendarRoutes } from './routes/calendar.js';
import { googleAdminRoutes, googlePublicRoutes } from './routes/google.js';
import { authGuard } from './plugins/authGuard.js';
import { startIncomingMessageWorker } from './workers/incomingMessage.js';
import { startAgentTurnWorker } from './workers/agentTurn.js';
import { startReminderDispatcher } from './workers/reminderDispatcher.js';
import { startInstanceMonitor } from './workers/instanceMonitor.js';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-webhook-secret"]',
          'req.body.password',
          'req.body.text',
          'req.body.message',
          'req.body.data.message',
          'req.body.data.key.remoteJid',
          'req.body.pushName',
          'body.content',
          'message.content',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: true,
  });

  await app.register(cors, { origin: [env.DASHBOARD_BASE_URL], credentials: true });
  await app.register(cookie, { secret: env.AUTH_SECRET });
  await app.register(sensible);

  // Fastify 5 rejeita Content-Type: application/json com body vazio.
  // Aceita string vazia como objeto vazio para nao quebrar POSTs sem body.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (text.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.register(healthRoutes);
  await app.register(webhookRoutes, { prefix: '/webhook' });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(eventsRoutes, { prefix: '/events' });
  // Feed iCal público — token na URL. Sem authGuard.
  await app.register(publicCalendarRoutes, { prefix: '/calendar' });
  // Callback OAuth do Google — público (state valida)
  await app.register(googlePublicRoutes, { prefix: '/google' });

  await app.register(async (instance) => {
    instance.addHook('preHandler', authGuard);
    await instance.register(conversationsRoutes, { prefix: '/conversations' });
    await instance.register(metricsRoutes, { prefix: '/metrics' });
    await instance.register(kbRoutes, { prefix: '/kb' });
    await instance.register(vaccinesRoutes, { prefix: '/vaccines' });
    await instance.register(settingsRoutes, { prefix: '/settings' });
    await instance.register(patientsRoutes, { prefix: '/patients' });
    await instance.register(campaignsRoutes, { prefix: '/campaigns' });
    await instance.register(usersRoutes, { prefix: '/users' });
    await instance.register(reportsRoutes, { prefix: '/reports' });
    await instance.register(appointmentsRoutes, { prefix: '/appointments' });
    await instance.register(instanceRoutes, { prefix: '/instance' });
    await instance.register(adminCalendarRoutes, { prefix: '/calendar' });
    await instance.register(googleAdminRoutes, { prefix: '/google' });
  });

  return app;
}

async function main() {
  const app = await buildServer();
  const worker = startIncomingMessageWorker(app.log);
  const agentWorker = startAgentTurnWorker(app.log);
  const reminderWorker = startReminderDispatcher(app.log);
  const instanceMonitor = startInstanceMonitor(app.log);

  const shutdown = async () => {
    app.log.info('shutdown signal received');
    reminderWorker.stop();
    instanceMonitor.stop();
    await worker.close();
    await agentWorker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await app.listen({ host: '0.0.0.0', port: env.API_PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
