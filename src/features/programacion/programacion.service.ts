// Programacion: el tipo de actividad asignado a cada dia (vuelo, deadhead, reserva, franco, sin asignar).
// Los datos de cada vuelo estan en la tabla vuelos. Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';
import type { NuevoDia } from './programacion.validation';

export async function listDias() {
  const dias = await prisma.programacion.findMany({ orderBy: { date: 'asc' } });

  return dias.map((dia) => ({
    // La fecha se guarda a medianoche UTC: con los primeros 10 caracteres queda YYYY-MM-DD
    date: dia.date.toISOString().slice(0, 10),
    type: dia.type,
  }));
}

// Guarda el tipo de cada dia. Si el dia ya estaba cargado (ej: se vuelve a importar el mismo mes), le cambia el tipo
export async function guardarDias(dias: NuevoDia[]): Promise<number> {
  await prisma.$transaction(
    dias.map((dia) => {
      const date = new Date(`${dia.date}T00:00:00Z`);
      return prisma.programacion.upsert({
        where: { date },
        update: { type: dia.type },
        create: { date, type: dia.type },
      });
    }),
  );
  return dias.length;
}
