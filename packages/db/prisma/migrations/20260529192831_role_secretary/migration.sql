-- Adiciona role 'secretary' (visao reduzida: Configuracoes, Vacinas, Fila,
-- Pacientes, Campanhas — sem metricas, KB ou usuarios).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'secretary';
