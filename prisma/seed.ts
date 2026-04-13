import bcrypt from "bcryptjs";
import { AvatarPreset, DashboardTone, PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.rewardSettings.upsert({
    where: { id: "default" },
    update: {
      starsPerWeekTarget: 5,
      weeksRequiredPerRank: 2,
    },
    create: {
      id: "default",
      starsPerWeekTarget: 5,
      weeksRequiredPerRank: 2,
    },
  });

  const adminPasswordHash = await bcrypt.hash("Admin12345!", 12);

  await prisma.user.upsert({
    where: { email: "admin@people.local" },
    update: {
      name: "Administrador",
      role: Role.ADMIN,
      isActive: true,
      passwordHash: adminPasswordHash,
      dashboardTone: DashboardTone.INDIGO,
      avatarPreset: AvatarPreset.WIZARD,
    },
    create: {
      name: "Administrador",
      email: "admin@people.local",
      role: Role.ADMIN,
      isActive: true,
      passwordHash: adminPasswordHash,
      dashboardTone: DashboardTone.INDIGO,
      avatarPreset: AvatarPreset.WIZARD,
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: {
        in: ["alice@people.local", "diego@people.local"],
      },
      role: Role.COLLABORATOR,
    },
  });

  console.log("Seed listo");
  console.log("Admin: admin@people.local / Admin12345!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
