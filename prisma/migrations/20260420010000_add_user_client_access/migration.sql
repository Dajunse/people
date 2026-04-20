CREATE TABLE "UserClientAccess" (
  "userId" TEXT NOT NULL,
  "client" TEXT NOT NULL,
  CONSTRAINT "UserClientAccess_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "User" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  PRIMARY KEY ("userId", "client")
);

CREATE INDEX "UserClientAccess_client_idx" ON "UserClientAccess"("client");

INSERT OR IGNORE INTO "UserClientAccess" ("userId", "client")
SELECT u."id", c."client"
FROM "User" u
CROSS JOIN (
  SELECT "SCIO" AS "client"
  UNION ALL SELECT "MAQUEX"
  UNION ALL SELECT "HULMEC"
  UNION ALL SELECT "BLAIR"
  UNION ALL SELECT "NEWELL"
  UNION ALL SELECT "ORBIT"
) c
WHERE u."role" = "COLLABORATOR";
