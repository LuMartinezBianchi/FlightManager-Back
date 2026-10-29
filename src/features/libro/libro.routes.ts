// Rutas HTTP del libro de vuelo: listar las hojas, guardar la de un vuelo y exportarlas a .xlsx.
import { Router } from 'express';

import { prisma } from '../../db';
import { exportarLibro } from './libro.exportar';
import { guardarHoja, listHojas } from './libro.service';
import { yaAterrizo } from '../vuelos/vuelos.tiempo';
import { validarHoja } from './libro.validation';

export const libroRouter = Router();

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

// POST /api/libro/exportar -> 200 con el .xlsx de los vuelos pedidos ([{ number, date }]), 400 si falta alguno o no esta completo
libroRouter.post('/api/libro/exportar', async (req, res) => {
  const pedidos: unknown = req.body;
  const validos =
    Array.isArray(pedidos) &&
    pedidos.length > 0 &&
    pedidos.every(
      (p) => typeof p?.number === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p?.date ?? ''),
    );
  if (!validos) return res.status(400).json({ error: 'Se espera una lista de vuelos (number y date)' });

  try {
    const vuelos = (pedidos as { number: string; date: string }[]).map((p) => ({ number: p.number.toUpperCase(), date: p.date }));
    const resultado = await exportarLibro(vuelos);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="libro_de_vuelo.xlsx"');
    res.send(resultado.archivo);
  } catch {
    res.status(500).json({ error: 'No se pudo generar el archivo' });
  }
});
