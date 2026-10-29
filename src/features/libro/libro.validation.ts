// Validacion de una hoja del libro de vuelo antes de tocar la base.
// Los campos son los mismos keys que usa el formulario de la app (logbook-form.ts).
import { prisma } from '../../db';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIEMPO = /^\d{1,2}:[0-5]\d$/;
const OACI = /^[A-Z]{4}$/;
const MATRICULA = /^[A-Z0-9-]{4,10}$/;
const MARCA = /^[A-Z0-9-]{2,10}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Campos de tiempo (h:mm), todos opcionales
export const CAMPOS_TIEMPO = [
  'sobreDiaPiloto', 'sobreDiaCopiloto', 'sobreNochePiloto', 'sobreNocheCopiloto',
  'travesiaDiaPiloto', 'travesiaDiaCopiloto', 'travesiaNochePiloto', 'travesiaNocheCopiloto',
  'instruccion', 'multimotor', 'reactor', 'turbohelice', 'adiestradorTerrestre',
  'instrumentoRealPiloto', 'instrumentoRealCopiloto', 'instrumentoCapota',
] as const;

export type CampoTiempo = (typeof CAMPOS_TIEMPO)[number];

export type HojaValida = {
  fecha: string;
  horaSalida: string;
  desde: string;
  hasta: string;
  horaLlegada: string;
  finalidadVuelo: string;
  marca: string;
  matricula: string;
  potencia: number;
  clase: string;
  // Tiempos en horas decimales
  tiempos: Partial<Record<CampoTiempo, number>>;
  navegadorMecanico: number | null;
  aterrizajes: number | null;
  firma: string | null;
};

export type ResultadoHoja = { ok: true; hoja: HojaValida } | { ok: false; errores: Record<string, string> };

function leer(valor: unknown) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// "1:30" -> 1.5
export function tiempoADecimal(texto: string) {
  const [horas, minutos] = texto.split(':').map(Number);
  return horas + minutos / 60;
}

// 1.5 -> "1:30"
export function decimalATiempo(valor: number) {
  const total = Math.round(valor * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function entero(texto: string, min: number, max: number) {
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n >= min && n <= max ? n : null;
}

export async function validarHoja(entrada: unknown): Promise<ResultadoHoja> {
  const datos = (entrada ?? {}) as Record<string, unknown>;
  const errores: Record<string, string> = {};

  const anio = leer(datos.anio);
  const mes = leer(datos.mes);
  const dia = leer(datos.dia);
  const fecha = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  const fechaDate = new Date(`${fecha}T00:00:00Z`);
  if (!FECHA.test(fecha) || Number.isNaN(fechaDate.getTime()) || fechaDate.getUTCDate() !== Number(dia)) {
    errores.dia = 'La fecha no existe';
  }

  const horaSalida = leer(datos.horaSalida);
  const horaLlegada = leer(datos.horaLlegada);
  if (!HORA.test(horaSalida)) errores.horaSalida = 'Hora de salida inválida (HH:mm)';
  if (!HORA.test(horaLlegada)) errores.horaLlegada = 'Hora de llegada inválida (HH:mm)';

  const desde = leer(datos.desde).toUpperCase();
  const hasta = leer(datos.hasta).toUpperCase();
  if (!OACI.test(desde)) errores.desde = 'Código OACI de 4 letras';
  if (!OACI.test(hasta)) errores.hasta = 'Código OACI de 4 letras';

  const finalidadVuelo = leer(datos.finalidadVuelo);
  if (finalidadVuelo.length < 3 || finalidadVuelo.length > 60) errores.finalidadVuelo = 'Entre 3 y 60 caracteres';

  const marca = leer(datos.marca).toUpperCase();
  const matricula = leer(datos.matricula).toUpperCase();
  if (!MARCA.test(marca)) errores.marca = 'Marca inválida';
  if (!MATRICULA.test(matricula)) errores.matricula = 'Matrícula inválida';

  const potencia = entero(leer(datos.potencia), 1, 999999);
  if (potencia === null) errores.potencia = 'Potencia inválida';

  const clase = leer(datos.clase);
  if (clase.length < 2 || clase.length > 30) errores.clase = 'Entre 2 y 30 caracteres';

  const tiempos: Partial<Record<CampoTiempo, number>> = {};
  for (const campo of CAMPOS_TIEMPO) {
    const texto = leer(datos[campo]);
    if (!texto) continue;
    if (!TIEMPO.test(texto) || tiempoADecimal(texto) > 24) {
      errores[campo] = 'Tiempo inválido (h:mm)';
      continue;
    }
    tiempos[campo] = tiempoADecimal(texto);
  }

  const leerCantidad = (clave: string) => {
    const texto = leer(datos[clave]);
    if (!texto) return null;
    const n = entero(texto, 0, 99);
    if (n === null) errores[clave] = 'Entero entre 0 y 99';
    return n;
  };
  const navegadorMecanico = leerCantidad('navegadorMecanico');
  const aterrizajes = leerCantidad('aterrizajes');

  const firma = leer(datos.firma) || null;

  if (Object.keys(errores).length > 0 || potencia === null) return { ok: false, errores };

  // Que los aeropuertos existan en el catalogo
  const aeropuertos = await prisma.aeropuerto.findMany({
    where: { icao: { in: [desde, hasta] } },
    select: { icao: true },
  });
  const conocidos = new Set(aeropuertos.map((a) => a.icao));
  if (!conocidos.has(desde)) errores.desde = 'Aeropuerto desconocido';
  if (!conocidos.has(hasta)) errores.hasta = 'Aeropuerto desconocido';
  if (Object.keys(errores).length > 0) return { ok: false, errores };

  return {
    ok: true,
    hoja: {
      fecha, horaSalida, desde, hasta, horaLlegada, finalidadVuelo, marca, matricula,
      potencia, clase, tiempos, navegadorMecanico, aterrizajes, firma,
    },
  };
}
