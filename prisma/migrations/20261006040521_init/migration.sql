-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "mode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sizeLabel" TEXT,
    "innerLengthCm" REAL NOT NULL,
    "innerWidthCm" REAL NOT NULL,
    "innerHeightCm" REAL NOT NULL,
    "heightOpen" BOOLEAN NOT NULL DEFAULT false,
    "maxPayloadKg" REAL NOT NULL,
    "tareKg" REAL NOT NULL DEFAULT 0,
    "floors" INTEGER NOT NULL DEFAULT 1,
    "axleGroups" JSONB NOT NULL,
    "costPerUnit" REAL NOT NULL DEFAULT 0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "extendable" BOOLEAN NOT NULL DEFAULT false,
    "maxExtendedLengthCm" REAL,
    "oogClass" TEXT NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipmentType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "orgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipmentSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentSetMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "equipmentTypeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "couplingGapCm" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "EquipmentSetMember_setId_fkey" FOREIGN KEY ("setId") REFERENCES "EquipmentSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquipmentSetMember_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'FEWEST_UNITS',
    "rules" JSONB NOT NULL,
    "solverSettings" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectEquipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "equipmentTypeId" TEXT,
    "equipmentSetId" TEXT,
    "minCount" INTEGER NOT NULL DEFAULT 0,
    "maxCount" INTEGER NOT NULL DEFAULT 1,
    "costPerUnit" REAL,
    CONSTRAINT "ProjectEquipment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectEquipment_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProjectEquipment_equipmentSetId_fkey" FOREIGN KEY ("equipmentSetId") REFERENCES "EquipmentSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CargoItem" (
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
    CONSTRAINT "CargoItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "summary" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquipmentInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "equipmentTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT,
    "metrics" JSONB NOT NULL,
    CONSTRAINT "EquipmentInstance_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquipmentInstance_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "cargoItemId" TEXT NOT NULL,
    "instanceIndex" INTEGER NOT NULL,
    "equipmentInstanceId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "xCm" REAL NOT NULL,
    "yCm" REAL NOT NULL,
    "zCm" REAL NOT NULL,
    "rotation" TEXT NOT NULL DEFAULT 'LWH',
    "lengthCm" REAL NOT NULL,
    "widthCm" REAL NOT NULL,
    "heightCm" REAL NOT NULL,
    CONSTRAINT "Placement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Placement_cargoItemId_fkey" FOREIGN KEY ("cargoItemId") REFERENCES "CargoItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Placement_equipmentInstanceId_fkey" FOREIGN KEY ("equipmentInstanceId") REFERENCES "EquipmentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UnloadedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "cargoItemId" TEXT NOT NULL,
    "instanceIndex" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" TEXT,
    CONSTRAINT "UnloadedItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UnloadedItem_cargoItemId_fkey" FOREIGN KEY ("cargoItemId") REFERENCES "CargoItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportMappingTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportMappingTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    CONSTRAINT "ShareLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentType_code_key" ON "EquipmentType"("code");

-- CreateIndex
CREATE INDEX "EquipmentType_mode_idx" ON "EquipmentType"("mode");

-- CreateIndex
CREATE INDEX "EquipmentType_orgId_idx" ON "EquipmentType"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentType_externalId_mode_key" ON "EquipmentType"("externalId", "mode");

-- CreateIndex
CREATE INDEX "EquipmentSet_orgId_idx" ON "EquipmentSet"("orgId");

-- CreateIndex
CREATE INDEX "EquipmentSetMember_setId_idx" ON "EquipmentSetMember"("setId");

-- CreateIndex
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "ProjectEquipment_projectId_idx" ON "ProjectEquipment"("projectId");

-- CreateIndex
CREATE INDEX "CargoItem_projectId_idx" ON "CargoItem"("projectId");

-- CreateIndex
CREATE INDEX "Plan_projectId_idx" ON "Plan"("projectId");

-- CreateIndex
CREATE INDEX "EquipmentInstance_planId_idx" ON "EquipmentInstance"("planId");

-- CreateIndex
CREATE INDEX "Placement_planId_idx" ON "Placement"("planId");

-- CreateIndex
CREATE INDEX "UnloadedItem_planId_idx" ON "UnloadedItem"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMappingTemplate_orgId_name_key" ON "ImportMappingTemplate"("orgId", "name");

-- CreateIndex
CREATE INDEX "ApiKey_prefix_idx" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
