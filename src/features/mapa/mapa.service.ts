// Lógica de datos del mapa de un vuelo. Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';

// fecha en YYYY-MM-DD identifica el vuelo exacto. Sin fecha, muestra el mas proximo (la fecha mas temprana)
export async function getMapaVuelo(number: string, fecha?: string) {
  const vuelo = await prisma.vuelo.findFirst({
    where: fecha ? { number, date: new Date(`${fecha}T00:00:00Z`) } : { number },
    orderBy: { date: 'asc' },
    include: { origin: true, destination: true },
  });

  if (!vuelo) return null;

  return {
    number: vuelo.number,
    origin: {
      iata: vuelo.origin.iata,
      name: vuelo.origin.name,
      latitude: vuelo.origin.latitude,
      longitude: vuelo.origin.longitude,
    },
    destination: {
      iata: vuelo.destination.iata,
      name: vuelo.destination.name,
      latitude: vuelo.destination.latitude,
      longitude: vuelo.destination.longitude,
    },
  };
}
