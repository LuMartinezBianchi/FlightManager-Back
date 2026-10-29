// Rutas HTTP de la programacion: listar y guardar el tipo de cada dia.
import { Router } from 'express';

import { guardarDias, listDias } from './programacion.service';
import { validarDias } from './programacion.validation';

export const programacionRouter = Router();

// GET /api/programacion -> 200 con la lista de dias y su tipo
programacionRouter.get('/api/programacion', async (_req, res) => {
  try {
    res.json(await listDias());
  } catch {
    res.status(500).json({ error: 'No se pudo leer la programación' });
  }
});

// POST /api/programacion -> 201 si se guardan todos, 400 si alguna fila es invalida
programacionRouter.post('/api/programacion', async (req, res) => {
  const validacion = validarDias(req.body);
  if (!validacion.ok) {
    return res.status(400).json({ error: 'Hay filas con datos inválidos', errores: validacion.errores });
  }

  try {
    res.status(201).json({ guardados: await guardarDias(validacion.dias) });
  } catch {
    res.status(500).json({ error: 'No se pudo guardar la programación' });
  }
});
