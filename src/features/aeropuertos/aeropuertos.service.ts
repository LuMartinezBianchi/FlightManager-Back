// Catalogo de aeropuertos cargados. Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';

export async function listAeropuertos() {
  return prisma.aeropuerto.findMany({
    select: { iata: true, icao: true, name: true },
    orderBy: { iata: 'asc' },
  });
}
