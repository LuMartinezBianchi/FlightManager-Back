// Rutas HTTP de los vuelos: listar, guardar, modificar y borrar (desde el parser o el alta manual).
import { Router } from 'express';

import { actualizarVuelo, crearVuelos, eliminarVuelo, listVuelos } from './vuelos.service';
import { validarVuelos } from './vuelos.validation';

export const vuelosRouter = Router();

// GET /api/vuelos -> 200 con la lista de vuelos cargados
vuelosRouter.get('/api/vuelos', async (_req, res) => {
  try {
    res.json(await listVuelos());
  } catch {
    res.status(500).json({ error: 'No se pudo leer los vuelos' });
  }
});

// POST /api/vuelos -> 201 si se guardan todos, 400 si alguna fila es invalida, 409 si algun vuelo ya existe
vuelosRouter.post('/api/vuelos', async (req, res) => {
  const validacion = await validarVuelos(req.body);
  if (!validacion.ok) {
    return res.status(400).json({ error: 'Hay filas con datos inválidos', errores: validacion.errores });
  }

  try {
    const resultado = await crearVuelos(validacion.vuelos);
    if ('duplicados' in resultado) {
      return res.status(409).json({ error: 'Ya existen vuelos con esos números', duplicados: resultado.duplicados });
    }
    res.status(201).json({ insertados: resultado.insertados });
  } catch {
    res.status(500).json({ error: 'No se pudo guardar los vuelos' });
  }
});

// PUT /api/vuelos/:number/:fecha -> 200 si se modifica, 400 si los datos no sirven, 404 si no existe, 409 si el nuevo numero+fecha ya existe
vuelosRouter.put('/api/vuelos/:number/:fecha', async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD' });

  const validacion = await validarVuelos([req.body]);
  if (!validacion.ok) {
    return res.status(400).json({ error: 'Hay datos inválidos', errores: validacion.errores });
  }

  try {
    const existe = await actualizarVuelo(numero, fecha, validacion.vuelos[0]);
    if (!existe) return res.status(404).json({ error: 'No existe el vuelo' });
    res.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un vuelo con ese número y fecha' });
    }
    res.status(500).json({ error: 'No se pudo modificar el vuelo' });
  }
});

// DELETE /api/vuelos/:number/:fecha -> 204 si se borra, 404 si no existe
vuelosRouter.delete('/api/vuelos/:number/:fecha', async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD' });

  try {
    const borrados = await eliminarVuelo(numero, fecha);
    if (borrados === 0) return res.status(404).json({ error: 'No existe el vuelo' });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'No se pudo eliminar el vuelo' });
  }
});
