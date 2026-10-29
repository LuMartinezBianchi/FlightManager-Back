// Validacion de los vuelos que llegan a la API, antes de tocar la base.
// Si una sola fila es invalida, no se guarda ninguna.
import { prisma } from '../../db';

export type NuevoVuelo = {
  number: string;
  // YYYY-MM-DD
  date: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  duration?: string;
  aircraft?: string;
  crew?: string;
};

export type ErrorFila = { fila: number; mensaje: string };

export type ResultadoValidacion = { ok: true; vuelos: NuevoVuelo[] } | { ok: false; errores: ErrorFila[] };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const IATA = /^[A-Z]{3}$/;

function esFechaReal(fecha: string) {
  if (!FECHA.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(anio, mes - 1, dia));
  return date.getUTCDate() === dia && date.getUTCMonth() === mes - 1;
}

// Duracion en formato "1h 50m". Si la llegada es antes que la salida, el vuelo cruza la medianoche
export function calcularDuracion(dep: string, arr: string) {
  const [h1, m1] = dep.split(':').map(Number);
  const [h2, m2] = arr.split(':').map(Number);
  const minutos = (((h2 * 60 + m2) - (h1 * 60 + m1)) % 1440 + 1440) % 1440;
  return `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, '0')}m`;
}

function leerTexto(valor: unknown) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// Revisa cada fila por separado y despues que los aeropuertos existan en la base
export async function validarVuelos(entrada: unknown): Promise<ResultadoValidacion> {
  if (!Array.isArray(entrada)) {
    return { ok: false, errores: [{ fila: 0, mensaje: 'Se espera una lista de vuelos' }] };
  }

  const errores: ErrorFila[] = [];
  const vuelos: NuevoVuelo[] = [];

  entrada.forEach((fila, indice) => {
    const numero = indice + 1;
    const datos = (fila ?? {}) as Record<string, unknown>;
    const number = leerTexto(datos.number).toUpperCase();
    const date = leerTexto(datos.date);
    const from = leerTexto(datos.from).toUpperCase();
    const to = leerTexto(datos.to).toUpperCase();
    const dep = leerTexto(datos.dep);
    const arr = leerTexto(datos.arr);
    const aircraft = leerTexto(datos.aircraft);
    const crew = leerTexto(datos.crew);

    if (!number) errores.push({ fila: numero, mensaje: 'Falta el número de vuelo' });
    if (!esFechaReal(date)) errores.push({ fila: numero, mensaje: 'La fecha no es válida (AAAA-MM-DD)' });
    if (!IATA.test(from)) errores.push({ fila: numero, mensaje: 'Origen inválido (código IATA de 3 letras)' });
    if (!IATA.test(to)) errores.push({ fila: numero, mensaje: 'Destino inválido (código IATA de 3 letras)' });
    if (from && from === to) errores.push({ fila: numero, mensaje: 'El origen no puede ser igual al destino' });
    if (!HORA.test(dep)) errores.push({ fila: numero, mensaje: 'La hora de salida no es válida (HH:mm)' });
    if (!HORA.test(arr)) errores.push({ fila: numero, mensaje: 'La hora de llegada no es válida (HH:mm)' });
    if (number && esFechaReal(date) && IATA.test(from) && IATA.test(to) && HORA.test(dep) && HORA.test(arr)) {
      const duracion = leerTexto(datos.duration) || calcularDuracion(dep, arr);
      vuelos.push({ number, date, from, to, dep, arr, duration: duracion, aircraft: aircraft || undefined, crew: crew || undefined });
    }
  });

  if (errores.length > 0) return { ok: false, errores };

  // Aeropuertos: cada codigo tiene que existir en el catalogo
  const codigos = [...new Set(vuelos.flatMap((vuelo) => [vuelo.from, vuelo.to]))];
  const existentes = await prisma.aeropuerto.findMany({ where: { iata: { in: codigos } }, select: { iata: true } });
  const conocidos = new Set(existentes.map((aeropuerto) => aeropuerto.iata));
  const desconocidos = codigos.filter((codigo) => !conocidos.has(codigo));
  if (desconocidos.length > 0) {
    const filas = vuelos
      .map((vuelo, indice) => ({ indice, vuelo }))
      .filter(({ vuelo }) => desconocidos.includes(vuelo.from) || desconocidos.includes(vuelo.to));
    return {
      ok: false,
      errores: filas.map(({ indice, vuelo }) => ({
        fila: indice + 1,
        mensaje: `Aeropuerto no cargado: ${[vuelo.from, vuelo.to].filter((c) => desconocidos.includes(c)).join(', ')}`,
      })),
    };
  }

  return { ok: true, vuelos };
}
