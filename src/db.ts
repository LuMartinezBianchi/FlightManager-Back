// Un solo cliente de Prisma para toda la API. Las rutas no crean su propio cliente.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
