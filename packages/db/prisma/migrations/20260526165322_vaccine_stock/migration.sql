-- Adiciona suporte a "em estoque / em falta" nas vacinas.
-- Quando "inStock" eh false, a IA passa a informar o paciente
-- que esta em falta e oferece anotar em lista de espera.

ALTER TABLE "vaccines" ADD COLUMN "inStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "vaccines" ADD COLUMN "outOfStockNote" TEXT;
