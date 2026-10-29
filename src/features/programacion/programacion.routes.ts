// Rutas HTTP de la programación: listar y guardar vuelos (desde el parser o el alta manual).
import { Router } from 'express';

import {
  actualizarProgramacion,
  crearProgramacion,
  eliminarProgramacion,
  listProgramacion,
} from './programacion.service';
import { validarVuelos } from './programacion.validation';

export const programacionRouter = Router();

// GET /api/programacion -> 200 con la lista de vuelos cargados
programacionRouter.get('/api/programacion', async (_req, res) => {
  try {
    res.json(await listProgramacion());
  } catch {
    res.status(500).json({ error: 'No se pudo leer la programación' });
  }
});

// POST /api/programacion -> 201 si se guardan todos, 400 si alguna fila es invalida, 409 si algun vuelo ya existe
programacionRouter.post('/api/programacion', async (req, res) => {
  const validacion = await validarVuelos(req.body);
  if (!validacion.ok) {
    return res.status(400).json({ error: 'Hay filas con datos inválidos', errores: validacion.errores });
  }

  try {
    const resultado = await crearProgramacion(validacion.vuelos);
    if ('duplicados' in resultado) {
      return res.status(409).json({ error: 'Ya existen vuelos con esos números', duplicados: resultado.duplicados });
    }
    res.status(201).json({ insertados: resultado.insertados });
  } catch {
    res.status(500).json({ error: 'No se pudo guardar la programación' });
  }
});

// PUT /api/programacion/:number/:fecha -> 200 si se modifica, 400 si los datos no sirven, 404 si no existe, 409 si el nuevo numero+fecha ya existe
programacionRouter.put('/api/programacion/:number/:fecha', async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD' });

  const validacion = await validarVuelos([req.body]);
  if (!validacion.ok) {
    return res.status(400).json({ error: 'Hay datos inválidos', errores: validacion.errores });
  }

  try {
    const existe = await actualizarProgramacion(numero, fecha, validacion.vuelos[0]);
    if (!existe) return res.status(404).json({ error: 'No existe el vuelo' });
    res.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un vuelo con ese número y fecha' });
    }
    res.status(500).json({ error: 'No se pudo modificar el vuelo' });
  }
});

// DELETE /api/programacion/:number/:fecha -> 204 si se borra, 404 si no existe
programacionRouter.delete('/api/programacion/:number/:fecha', async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD' });

  try {
    const borrados = await eliminarProgramacion(numero, fecha);
    if (borrados === 0) return res.status(404).json({ error: 'No existe el vuelo' });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'No se pudo eliminar el vuelo' });
  }
});
