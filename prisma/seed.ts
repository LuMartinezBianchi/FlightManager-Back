// Carga inicial del catálogo de aeropuertos: Argentina y los 20 principales de Brasil.
// La programación no se carga acá: la cargan el parser o el alta manual.
// Corre con: npm run db:seed
import { readFileSync } from 'fs';
import { join } from 'path';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AeropuertoJson = { iata: string; icao: string; name: string; latitude: number; longitude: number };

const ARCHIVOS = ['aeropuertos-ar.json', 'aeropuertos-br.json'];

async function main() {
  const aeropuertos: AeropuertoJson[] = ARCHIVOS.flatMap((archivo) =>
    JSON.parse(readFileSync(join(__dirname, 'data', archivo), 'utf8')),
  );

  for (const aeropuerto of aeropuertos) {
    await prisma.aeropuerto.upsert({
      where: { iata: aeropuerto.iata },
      update: aeropuerto,
      create: aeropuerto,
    });
  }

  console.log(`Seed listo: ${aeropuertos.length} aeropuertos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
