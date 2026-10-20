-- Redrawn planner fields. SQLite ignores ADD COLUMN if a later push already applied it.

ALTER TABLE "Project" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'SEA';
ALTER TABLE "Project" ADD COLUMN "etd" DATETIME;
ALTER TABLE "ProjectEquipment" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE "CargoItem" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CargoItem" ADD COLUMN "sku" TEXT;
ALTER TABLE "CargoItem" ADD COLUMN "bottomOnly" BOOLEAN NOT NULL DEFAULT 0;
