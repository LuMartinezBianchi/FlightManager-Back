// Programación de vuelos (los que cargó el parser o a mano). Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';
import type { NuevoVuelo } from './programacion.validation';

export async function listProgramacion() {
  const vuelos = await prisma.programacion.findMany({
    include: { origin: true, destination: true },
    orderBy: [{ date: 'asc' }, { dep: 'asc' }],
  });

  return vuelos.map((vuelo) => ({
    number: vuelo.number,
    // La fecha se guarda a medianoche UTC: con los primeros 10 caracteres queda YYYY-MM-DD
    date: vuelo.date.toISOString().slice(0, 10),
    from: vuelo.origin.iata,
    to: vuelo.destination.iata,
    dep: vuelo.dep,
    arr: vuelo.arr,
    duration: vuelo.duration,
    aircraft: vuelo.aircraft,
    crew: vuelo.crew,
    source: vuelo.source,
  }));
}

export type ResultadoCreacion = { insertados: number } | { duplicados: string[] };

// Guarda todos los vuelos o ninguno: si alguno ya existe (en la base o repetido en el mismo envio), no inserta nada
export async function crearProgramacion(vuelos: NuevoVuelo[]): Promise<ResultadoCreacion> {
  // Un vuelo se identifica por numero + fecha: el mismo numero puede volver otro dia
  const claves = vuelos.map((vuelo) => ({ number: vuelo.number, date: new Date(`${vuelo.date}T00:00:00Z`) }));
  const etiqueta = (numero: string, fecha: Date) => `${numero} ${fecha.toISOString().slice(0, 10)}`;

  const yaGuardados = await prisma.programacion.findMany({
    where: { OR: claves },
    select: { number: true, date: true },
  });
  const etiquetas = claves.map((clave) => etiqueta(clave.number, clave.date));
  const repetidosEnEnvio = etiquetas.filter((valor, indice) => etiquetas.indexOf(valor) !== indice);
  const duplicados = [
    ...new Set([...yaGuardados.map((vuelo) => etiqueta(vuelo.number, vuelo.date)), ...repetidosEnEnvio]),
  ];
  if (duplicados.length > 0) return { duplicados };

  const codigos = [...new Set(vuelos.flatMap((vuelo) => [vuelo.from, vuelo.to]))];
  const aeropuertos = await prisma.aeropuerto.findMany({ where: { iata: { in: codigos } } });
  const idPorIata = new Map(aeropuertos.map((aeropuerto) => [aeropuerto.iata, aeropuerto.id]));

  await prisma.$transaction(
    vuelos.map((vuelo) =>
      prisma.programacion.create({
        data: {
          number: vuelo.number,
          date: new Date(`${vuelo.date}T00:00:00Z`),
          originId: idPorIata.get(vuelo.from)!,
          destinationId: idPorIata.get(vuelo.to)!,
          dep: vuelo.dep,
          arr: vuelo.arr,
          duration: vuelo.duration ?? '',
          aircraft: vuelo.aircraft ?? null,
          crew: vuelo.crew ?? null,
          source: vuelo.source,
        },
      }),
    ),
  );

  return { insertados: vuelos.length };
}

// Busca el vuelo por numero + fecha (la fecha llega en YYYY-MM-DD) y lo reemplaza con los datos nuevos.
// Devuelve false si no existe. Si el numero y fecha nuevos chocan con otro vuelo, Prisma lanza P2002.
export async function actualizarProgramacion(numero: string, fecha: string, vuelo: NuevoVuelo): Promise<boolean> {
  const actual = await prisma.programacion.findFirst({
    where: { number: numero, date: new Date(`${fecha}T00:00:00Z`) },
    select: { id: true },
  });
  if (!actual) return false;

  const aeropuertos = await prisma.aeropuerto.findMany({
    where: { iata: { in: [vuelo.from, vuelo.to] } },
  });
  const idPorIata = new Map(aeropuertos.map((aeropuerto) => [aeropuerto.iata, aeropuerto.id]));

  await prisma.programacion.update({
    where: { id: actual.id },
    data: {
      number: vuelo.number,
      date: new Date(`${vuelo.date}T00:00:00Z`),
      originId: idPorIata.get(vuelo.from)!,
      destinationId: idPorIata.get(vuelo.to)!,
      dep: vuelo.dep,
      arr: vuelo.arr,
      duration: vuelo.duration ?? '',
      aircraft: vuelo.aircraft ?? null,
      crew: vuelo.crew ?? null,
    },
  });
  return true;
}

// Borra el vuelo identificado por numero + fecha. Devuelve cuantos borro (0 si no existia).
export async function eliminarProgramacion(numero: string, fecha: string): Promise<number> {
  const resultado = await prisma.programacion.deleteMany({
    where: { number: numero, date: new Date(`${fecha}T00:00:00Z`) },
  });
  return resultado.count;
}
