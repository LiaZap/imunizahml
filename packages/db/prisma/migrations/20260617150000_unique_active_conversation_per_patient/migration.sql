-- Garante que so pode existir UMA conversa "ativa" (active / awaiting_handoff /
-- assigned) por paciente. Race condition no worker estava criando duplicatas
-- quando duas mensagens chegavam em paralelo (ambos findFirst retornavam null,
-- ambos faziam create).
--
-- Antes de criar o index, fecha as duplicatas existentes pra nao quebrar.

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "patientId"
      ORDER BY "lastMessageAt" DESC
    ) AS rn
  FROM conversations
  WHERE status IN ('active', 'awaiting_handoff', 'assigned')
)
UPDATE conversations
SET status = 'closed'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "conversations_active_per_patient_unique"
ON conversations ("tenantId", "patientId")
WHERE status IN ('active', 'awaiting_handoff', 'assigned');
