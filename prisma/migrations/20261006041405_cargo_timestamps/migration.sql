/*
  Warnings:

  - Added the required column `updatedAt` to the `CargoItem` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CargoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lengthCm" REAL NOT NULL,
    "widthCm" REAL NOT NULL,
    "heightCm" REAL NOT NULL,
    "weightKg" REAL NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "shape" TEXT NOT NULL DEFAULT 'BOX',
    "orientation" TEXT NOT NULL DEFAULT 'ANY',
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "maxStackLoadKg" REAL,
    "maxStackLayers" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "destinationStop" INTEGER NOT NULL DEFAULT 1,
    "consignmentId" TEXT,
    "segregationClass" TEXT,
    "color" TEXT,
    "customFields" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CargoItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CargoItem" ("color", "consignmentId", "customFields", "destinationStop", "heightCm", "id", "lengthCm", "maxStackLayers", "maxStackLoadKg", "name", "orientation", "priority", "projectId", "quantity", "segregationClass", "shape", "stackable", "weightKg", "widthCm") SELECT "color", "consignmentId", "customFields", "destinationStop", "heightCm", "id", "lengthCm", "maxStackLayers", "maxStackLoadKg", "name", "orientation", "priority", "projectId", "quantity", "segregationClass", "shape", "stackable", "weightKg", "widthCm" FROM "CargoItem";
DROP TABLE "CargoItem";
ALTER TABLE "new_CargoItem" RENAME TO "CargoItem";
CREATE INDEX "CargoItem_projectId_idx" ON "CargoItem"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
