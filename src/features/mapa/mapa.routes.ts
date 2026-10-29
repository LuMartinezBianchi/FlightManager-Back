// Rutas HTTP del mapa. Valida la entrada, llama al service y traduce el resultado a status codes.
import { Router } from 'express';

import { getMapaVuelo } from './mapa.service';

export const mapaRouter = Router();

// GET /api/vuelos/:number/mapa -> 200 con origen y destino, 404 si el vuelo no existe, 500 si falla la base
mapaRouter.get('/api/vuelos/:number/mapa', async (req, res) => {
  const number = String(req.params.number ?? '').trim().toUpperCase();
  if (!number) return res.status(400).json({ error: 'El número de vuelo no es válido' });

  try {
    const mapa = await getMapaVuelo(number);
    if (!mapa) return res.status(404).json({ error: 'No existe el vuelo' });
    res.json(mapa);
  } catch {
    res.status(500).json({ error: 'No se pudo leer el mapa del vuelo' });
  }
});
