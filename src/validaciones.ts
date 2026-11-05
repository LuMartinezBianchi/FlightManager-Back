// Validaciones del body de cada endpoint. Sin Express: reciben el body y devuelven
// { ok: true, ... } con los datos limpios, o { ok: false, errores } para responder 400.
// Se usan desde index.ts (cada funcion indica a que endpoint pertenece).
import { prisma } from "./db";

// -----------------------------------------------------------------------------
// 1. Piezas comunes
// -----------------------------------------------------------------------------

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const IATA = /^[A-Z]{3}$/;
const OACI = /^[A-Z]{4}$/;

// Lee un valor del body como texto sin espacios ('' si no es texto).
function leer(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

// true si el texto es AAAA-MM-DD y el dia existe (rechaza 2026-02-31).
export function esFechaReal(fecha: string): boolean {
  if (!FECHA.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(anio, mes - 1, dia));
  return date.getUTCDate() === dia && date.getUTCMonth() === mes - 1;
}

// Las fechas se guardan siempre a medianoche UTC.
export function aFecha(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

// Date de la base -> "AAAA-MM-DD".
export function deFecha(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// 2. Vuelos  (POST /api/vuelos y PUT /api/vuelos/:number/:fecha)
// -----------------------------------------------------------------------------

export type NuevoVuelo = {
  number: string;
  date: string; // AAAA-MM-DD
  from: string; // IATA
  to: string; // IATA
  dep: string; // HH:mm
  arr: string; // HH:mm
  duration: string;
  aircraft?: string;
  crew?: string;
};

type ErrorFila = { fila: number; mensaje: string };

// "1h 50m". Si llega antes de salir, cruza la medianoche.
function calcularDuracion(dep: string, arr: string): string {
  const [h1, m1] = dep.split(":").map(Number);
  const [h2, m2] = arr.split(":").map(Number);
  const minutos = ((h2 * 60 + m2 - (h1 * 60 + m1)) % 1440 + 1440) % 1440;
  return `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, "0")}m`;
}

// Recibe una lista de vuelos. Si UNA fila es invalida no se guarda ninguna.
export async function validarVuelos(
  entrada: unknown,
): Promise<{ ok: true; vuelos: NuevoVuelo[] } | { ok: false; errores: ErrorFila[] }> {
  if (!Array.isArray(entrada)) {
    return { ok: false, errores: [{ fila: 0, mensaje: "Se espera una lista de vuelos" }] };
  }

  const errores: ErrorFila[] = [];
  const vuelos: NuevoVuelo[] = [];

  entrada.forEach((fila, indice) => {
    const n = indice + 1; // numero de fila para mostrar al usuario
    const d = (fila ?? {}) as Record<string, unknown>;
    const number = leer(d.number).toUpperCase();
    const date = leer(d.date);
    const from = leer(d.from).toUpperCase();
    const to = leer(d.to).toUpperCase();
    const dep = leer(d.dep);
    const arr = leer(d.arr);

    const antes = errores.length;
    if (!number) errores.push({ fila: n, mensaje: "Falta el número de vuelo" });
    if (!esFechaReal(date)) errores.push({ fila: n, mensaje: "La fecha no es válida (AAAA-MM-DD)" });
    if (!IATA.test(from)) errores.push({ fila: n, mensaje: "Origen inválido (código IATA de 3 letras)" });
    if (!IATA.test(to)) errores.push({ fila: n, mensaje: "Destino inválido (código IATA de 3 letras)" });
    if (from && from === to) errores.push({ fila: n, mensaje: "El origen no puede ser igual al destino" });
    if (!HORA.test(dep)) errores.push({ fila: n, mensaje: "La hora de salida no es válida (HH:mm)" });
    if (!HORA.test(arr)) errores.push({ fila: n, mensaje: "La hora de llegada no es válida (HH:mm)" });
    if (errores.length > antes) return;

    vuelos.push({
      number,
      date,
      from,
      to,
      dep,
      arr,
      duration: leer(d.duration) || calcularDuracion(dep, arr),
      aircraft: leer(d.aircraft) || undefined,
      crew: leer(d.crew) || undefined,
    });
  });

  if (errores.length > 0) return { ok: false, errores };

  // Cada codigo IATA tiene que existir en la tabla aeropuertos.
  const codigos = [...new Set(vuelos.flatMap((v) => [v.from, v.to]))];
  const existentes = await prisma.aeropuerto.findMany({ where: { iata: { in: codigos } }, select: { iata: true } });
  const conocidos = new Set(existentes.map((a) => a.iata));

  vuelos.forEach((v, indice) => {
    const faltan = [v.from, v.to].filter((c) => !conocidos.has(c));
    if (faltan.length > 0) errores.push({ fila: indice + 1, mensaje: `Aeropuerto no cargado: ${faltan.join(", ")}` });
  });
  if (errores.length > 0) return { ok: false, errores };

  return { ok: true, vuelos };
}

// -----------------------------------------------------------------------------
// 3. Programacion  (POST /api/programacion)
// -----------------------------------------------------------------------------

const TIPOS_DIA = ["vuelo", "deadhead", "reserva", "franco", "sin_asignar"];

export type NuevoDia = { date: string; type: string };

// Recibe una lista de { date, type }. Si UNA fila es invalida no se guarda ninguna.
export function validarDias(
  entrada: unknown,
): { ok: true; dias: NuevoDia[] } | { ok: false; errores: ErrorFila[] } {
  if (!Array.isArray(entrada)) {
    return { ok: false, errores: [{ fila: 0, mensaje: "Se espera una lista de dias" }] };
  }

  const errores: ErrorFila[] = [];
  const dias: NuevoDia[] = [];

  entrada.forEach((fila, indice) => {
    const d = (fila ?? {}) as Record<string, unknown>;
    const date = leer(d.date);
    const type = leer(d.type);

    const fechaOk = esFechaReal(date);
    const tipoOk = TIPOS_DIA.includes(type);
    if (!fechaOk) errores.push({ fila: indice + 1, mensaje: "La fecha no es válida (AAAA-MM-DD)" });
    if (!tipoOk) errores.push({ fila: indice + 1, mensaje: `El tipo de día tiene que ser: ${TIPOS_DIA.join(", ")}` });
    if (fechaOk && tipoOk) dias.push({ date, type });
  });

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, dias };
}

// -----------------------------------------------------------------------------
// 4. Libro de vuelo  (PUT /api/libro/:number/:fecha)
// -----------------------------------------------------------------------------

// Campos de tiempo del formulario ("h:mm"), todos opcionales. En la base van en horas decimales.
export const CAMPOS_TIEMPO = [
  "sobreDiaPiloto", "sobreDiaCopiloto", "sobreNochePiloto", "sobreNocheCopiloto",
  "travesiaDiaPiloto", "travesiaDiaCopiloto", "travesiaNochePiloto", "travesiaNocheCopiloto",
  "instruccion", "multimotor", "reactor", "turbohelice", "adiestradorTerrestre",
  "instrumentoRealPiloto", "instrumentoRealCopiloto", "instrumentoCapota",
] as const;

type CampoTiempo = (typeof CAMPOS_TIEMPO)[number];

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
  tiempos: Partial<Record<CampoTiempo, number>>; // horas decimales
  navegadorMecanico: number | null;
  aterrizajes: number | null;
  firma: string | null; // PNG en base64
};

// "1:30" -> 1.5
function tiempoADecimal(texto: string): number {
  const [horas, minutos] = texto.split(":").map(Number);
  return horas + minutos / 60;
}

// 1.5 -> "1:30"
export function decimalATiempo(valor: number): string {
  const total = Math.round(valor * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Texto -> entero entre min y max, o null si no sirve.
function entero(texto: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n >= min && n <= max ? n : null;
}

// Recibe el formulario del libro. Los errores van por campo: { horaSalida: "mensaje", ... }.
export async function validarHoja(
  entrada: unknown,
): Promise<{ ok: true; hoja: HojaValida } | { ok: false; errores: Record<string, string> }> {
  const d = (entrada ?? {}) as Record<string, unknown>;
  const errores: Record<string, string> = {};

  // La fecha llega partida en anio / mes / dia.
  const dia = leer(d.dia);
  const fecha = `${leer(d.anio)}-${leer(d.mes).padStart(2, "0")}-${dia.padStart(2, "0")}`;
  if (!esFechaReal(fecha)) errores.dia = "La fecha no existe";

  const horaSalida = leer(d.horaSalida);
  const horaLlegada = leer(d.horaLlegada);
  if (!HORA.test(horaSalida)) errores.horaSalida = "Hora de salida inválida (HH:mm)";
  if (!HORA.test(horaLlegada)) errores.horaLlegada = "Hora de llegada inválida (HH:mm)";

  const desde = leer(d.desde).toUpperCase();
  const hasta = leer(d.hasta).toUpperCase();
  if (!OACI.test(desde)) errores.desde = "Código OACI de 4 letras";
  if (!OACI.test(hasta)) errores.hasta = "Código OACI de 4 letras";

  const finalidadVuelo = leer(d.finalidadVuelo);
  if (finalidadVuelo.length < 3 || finalidadVuelo.length > 60) errores.finalidadVuelo = "Entre 3 y 60 caracteres";

  const marca = leer(d.marca).toUpperCase();
  const matricula = leer(d.matricula).toUpperCase();
  if (!/^[A-Z0-9-]{2,10}$/.test(marca)) errores.marca = "Marca inválida";
  if (!/^[A-Z0-9-]{4,10}$/.test(matricula)) errores.matricula = "Matrícula inválida";

  const potencia = entero(leer(d.potencia), 1, 999999);
  if (potencia === null) errores.potencia = "Potencia inválida";

  const clase = leer(d.clase);
  if (clase.length < 2 || clase.length > 30) errores.clase = "Entre 2 y 30 caracteres";

  // Tiempos opcionales: vacio = sin dato.
  const tiempos: Partial<Record<CampoTiempo, number>> = {};
  for (const campo of CAMPOS_TIEMPO) {
    const texto = leer(d[campo]);
    if (!texto) continue;
    if (!/^\d{1,2}:[0-5]\d$/.test(texto) || tiempoADecimal(texto) > 24) {
      errores[campo] = "Tiempo inválido (h:mm)";
      continue;
    }
    tiempos[campo] = tiempoADecimal(texto);
  }

  // Cantidades opcionales (0 a 99).
  const cantidad = (clave: string): number | null => {
    const texto = leer(d[clave]);
    if (!texto) return null;
    const n = entero(texto, 0, 99);
    if (n === null) errores[clave] = "Entero entre 0 y 99";
    return n;
  };
  const navegadorMecanico = cantidad("navegadorMecanico");
  const aterrizajes = cantidad("aterrizajes");

  if (Object.keys(errores).length > 0 || potencia === null) return { ok: false, errores };

  // Los dos aeropuertos (codigo OACI) tienen que existir en la tabla aeropuertos.
  const aeropuertos = await prisma.aeropuerto.findMany({ where: { icao: { in: [desde, hasta] } }, select: { icao: true } });
  const conocidos = new Set(aeropuertos.map((a) => a.icao));
  if (!conocidos.has(desde)) errores.desde = "Aeropuerto desconocido";
  if (!conocidos.has(hasta)) errores.hasta = "Aeropuerto desconocido";
  if (Object.keys(errores).length > 0) return { ok: false, errores };

  return {
    ok: true,
    hoja: {
      fecha, horaSalida, desde, hasta, horaLlegada, finalidadVuelo, marca, matricula,
      potencia, clase, tiempos, navegadorMecanico, aterrizajes, firma: leer(d.firma) || null,
    },
  };
}

// -----------------------------------------------------------------------------
// 5. Regla del libro: no se carga una hoja de un vuelo que todavia no aterrizo
// -----------------------------------------------------------------------------

const minutosDelDia = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
};

// Si llega antes de la hora de salida, aterriza al dia siguiente.
export function yaAterrizo(fecha: string, dep: string, arr: string): boolean {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const hora = arr || dep;
  const llegada = new Date(anio, mes - 1, dia, Math.floor(minutosDelDia(hora) / 60), minutosDelDia(hora) % 60);
  if (minutosDelDia(hora) < minutosDelDia(dep)) llegada.setDate(llegada.getDate() + 1);
  return llegada <= new Date();
}
