// UN solo PrismaClient para toda la API (index.ts y los demas archivos lo importan de aca).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
