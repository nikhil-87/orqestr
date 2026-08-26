/*
  Warnings:

  - A unique constraint covering the columns `[name,type]` on the table `agents` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "agents_name_type_key" ON "agents"("name", "type");
