// Rutas HTTP del catalogo de aeropuertos. La app lo usa para validar la carga manual antes de guardar.
import { Router } from 'express';

import { listAeropuertos } from './aeropuertos.service';

export const aeropuertosRouter = Router();

// GET /api/aeropuertos -> 200 con todos los aeropuertos cargados (IATA, OACI y nombre)
aeropuertosRouter.get('/api/aeropuertos', async (_req, res) => {
  try {
    res.json(await listAeropuertos());
  } catch {
    res.status(500).json({ error: 'No se pudo leer los aeropuertos' });
  }
});
