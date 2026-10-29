// Rutas HTTP de la meteorologia de aeropuertos.
import { Router } from 'express';

import { getMeteo } from './meteo.service';

export const meteoRouter = Router();

// GET /api/meteo?icao=SAEZ,SACO -> 200 con el ultimo METAR de cada aeropuerto, 400 si los codigos no sirven, 502 si falla NOAA
meteoRouter.get('/api/meteo', async (req, res) => {
  const icaos = String(req.query.icao ?? '')
    .split(',')
    .map((codigo) => codigo.trim().toUpperCase())
    .filter(Boolean);

  if (icaos.length === 0 || icaos.length > 10 || !icaos.every((codigo) => /^[A-Z]{4}$/.test(codigo))) {
    return res.status(400).json({ error: 'Pasá hasta 10 códigos OACI de 4 letras separados por coma (icao=SAEZ,SACO)' });
  }

  try {
    res.json(await getMeteo([...new Set(icaos)]));
  } catch {
    res.status(502).json({ error: 'No se pudo consultar la meteorología' });
  }
});
