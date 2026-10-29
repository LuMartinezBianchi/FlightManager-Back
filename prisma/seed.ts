// Carga inicial de aeropuertos y vuelos. Corre con: npm run db:seed
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const airports = [
  { iata: 'EZE', name: 'Aeropuerto Internacional de Ezeiza', latitude: -34.8222, longitude: -58.5358 },
  { iata: 'COR', name: 'Aeropuerto Internacional Ingeniero Aeronáutico Ambrosio L.V. Taravella', latitude: -31.3236, longitude: -64.208 },
  { iata: 'MDZ', name: 'Aeropuerto Internacional El Plumerillo', latitude: -32.8317, longitude: -68.7929 },
  { iata: 'AEP', name: 'Aeroparque Jorge Newbery', latitude: -34.5592, longitude: -58.4156 },
  { iata: 'BRC', name: 'Aeropuerto Internacional Teniente Luis Candelaria', latitude: -41.1512, longitude: -71.1575 },
];

// Vuelos: los codigos IATA de origen y destino se resuelven contra la tabla de aeropuertos
const flights = [
  { number: 'AR1204', from: 'EZE', to: 'COR', dep: '07:15', arr: '09:05', duration: '1h 50m', aircraft: 'Boeing 737-800' },
  { number: 'AR1207', from: 'COR', to: 'MDZ', dep: '10:10', arr: '11:35', duration: '1h 25m', aircraft: 'Boeing 737-800' },
  { number: 'AR1210', from: 'MDZ', to: 'EZE', dep: '12:40', arr: '14:30', duration: '1h 50m', aircraft: 'Boeing 737-800' },
  { number: 'AR1672', from: 'AEP', to: 'BRC', dep: '08:15', arr: '10:35', duration: '2h 20m', aircraft: 'Boeing 737 MAX 8' },
  { number: 'AR1673', from: 'BRC', to: 'AEP', dep: '11:30', arr: '13:40', duration: '2h 10m', aircraft: 'Boeing 737 MAX 8' },
];

async function main() {
  for (const airport of airports) {
    await prisma.airport.upsert({
      where: { iata: airport.iata },
      update: airport,
      create: airport,
    });
  }

  for (const flight of flights) {
    const origin = await prisma.airport.findUniqueOrThrow({ where: { iata: flight.from } });
    const destination = await prisma.airport.findUniqueOrThrow({ where: { iata: flight.to } });

    await prisma.flight.upsert({
      where: { number: flight.number },
      update: {
        originId: origin.id,
        destinationId: destination.id,
        dep: flight.dep,
        arr: flight.arr,
        duration: flight.duration,
        aircraft: flight.aircraft,
      },
      create: {
        number: flight.number,
        originId: origin.id,
        destinationId: destination.id,
        dep: flight.dep,
        arr: flight.arr,
        duration: flight.duration,
        aircraft: flight.aircraft,
      },
    });
  }

  console.log(`Seed listo: ${airports.length} aeropuertos, ${flights.length} vuelos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
