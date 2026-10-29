// Lógica de datos del mapa de un vuelo. Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';

export async function getMapaVuelo(number: string) {
  const flight = await prisma.flight.findUnique({
    where: { number },
    include: { origin: true, destination: true },
  });

  if (!flight) return null;

  return {
    number: flight.number,
    origin: {
      iata: flight.origin.iata,
      name: flight.origin.name,
      latitude: flight.origin.latitude,
      longitude: flight.origin.longitude,
    },
    destination: {
      iata: flight.destination.iata,
      name: flight.destination.name,
      latitude: flight.destination.latitude,
      longitude: flight.destination.longitude,
    },
  };
}
