-- Adiciona campo metadata em appointments (para guardar googleEventId etc).
ALTER TABLE "appointments" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
