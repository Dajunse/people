ALTER TABLE "User" ADD COLUMN "primaryClient" TEXT;

UPDATE "User"
SET "primaryClient" = (
  SELECT uca."client"
  FROM "UserClientAccess" uca
  WHERE uca."userId" = "User"."id"
  ORDER BY uca."client" ASC
  LIMIT 1
)
WHERE "role" IN ('COLLABORATOR', 'MANAGER')
  AND "primaryClient" IS NULL;
