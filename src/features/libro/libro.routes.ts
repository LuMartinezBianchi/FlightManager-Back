// Rutas HTTP del libro de vuelo: listar las hojas y guardar la de un vuelo.
import { Router } from 'express';

import { prisma } from '../../db';
import { guardarHoja, listHojas } from './libro.service';
import { validarHoja } from './libro.validation';

export const libroRouter = Router();

// El vuelo ya paso cuando su llegada es anterior a ahora (si llega antes de salir, aterriza al dia siguiente)
function yaAterrizo(fecha: string, dep: string, arr: string) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [depH, depM] = dep.split(':').map(Number);
  const [arrH, arrM] = (arr || dep).split(':').map(Number);
  const llegada = new Date(anio, mes - 1, dia, arrH, arrM);
  if (arrH * 60 + arrM < depH * 60 + depM) llegada.setDate(llegada.getDate() + 1);
  return llegada <= new Date();
}

// GET /api/libro -> 200 con las hojas guardadas
libroRouter.get('/api/libro', async (_req, res) => {
  try {
    res.json(await listHojas());
  } catch {
    res.status(500).json({ error: 'No se pudo leer el libro de vuelo' });
  }
});

// PUT /api/libro/:number/:fecha -> 200 si se guarda, 400 si los datos no sirven, 404 si el vuelo no existe
libroRouter.put('/api/libro/:number/:fecha', async (req, res) => {
  const number = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD' });

  const validacion = await validarHoja(req.body);
  if (!validacion.ok) return res.status(400).json({ error: 'Hay datos inválidos', errores: validacion.errores });

  try {
    const vuelo = await prisma.vuelo.findUnique({
      where: { number_date: { number, date: new Date(`${fecha}T00:00:00Z`) } },
      select: { dep: true, arr: true },
    });
    if (!vuelo) return res.status(404).json({ error: 'No existe el vuelo' });
    if (!yaAterrizo(fecha, vuelo.dep, vuelo.arr)) {
      return res.status(400).json({ error: 'El vuelo todavía no se realizó' });
    }

    await guardarHoja(number, fecha, validacion.hoja);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'No se pudo guardar el libro de vuelo' });
  }
});
