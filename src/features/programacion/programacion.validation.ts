// Validacion de los dias de la programacion que llegan a la API, antes de tocar la base.
// Si una sola fila es invalida, no se guarda ninguna.

export const TIPOS_DIA = ['vuelo', 'deadhead', 'reserva', 'franco', 'sin_asignar'] as const;

export type TipoDia = (typeof TIPOS_DIA)[number];

export type NuevoDia = {
  // YYYY-MM-DD
  date: string;
  type: TipoDia;
};

export type ErrorFila = { fila: number; mensaje: string };

export type ResultadoValidacion = { ok: true; dias: NuevoDia[] } | { ok: false; errores: ErrorFila[] };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esFechaReal(fecha: string) {
  if (!FECHA.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(anio, mes - 1, dia));
  return date.getUTCDate() === dia && date.getUTCMonth() === mes - 1;
}

export function validarDias(entrada: unknown): ResultadoValidacion {
  if (!Array.isArray(entrada)) {
    return { ok: false, errores: [{ fila: 0, mensaje: 'Se espera una lista de dias' }] };
  }

  const errores: ErrorFila[] = [];
  const dias: NuevoDia[] = [];

  entrada.forEach((fila, indice) => {
    const numero = indice + 1;
    const datos = (fila ?? {}) as Record<string, unknown>;
    const date = typeof datos.date === 'string' ? datos.date.trim() : '';
    const type = typeof datos.type === 'string' ? datos.type.trim() : '';

    if (!esFechaReal(date)) errores.push({ fila: numero, mensaje: 'La fecha no es válida (AAAA-MM-DD)' });
    if (!TIPOS_DIA.includes(type as TipoDia)) {
      errores.push({ fila: numero, mensaje: `El tipo de día tiene que ser: ${TIPOS_DIA.join(', ')}` });
    }
    if (esFechaReal(date) && TIPOS_DIA.includes(type as TipoDia)) dias.push({ date, type: type as TipoDia });
  });

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, dias };
}
