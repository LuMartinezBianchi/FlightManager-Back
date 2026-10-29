// Punto de entrada: configura Express y registra cada feature.
import 'dotenv/config';

import cors from 'cors';
import express from 'express';

import { aeropuertosRouter } from './features/aeropuertos/aeropuertos.routes';
import { libroRouter } from './features/libro/libro.routes';
import { mapaRouter } from './features/mapa/mapa.routes';
import { programacionRouter } from './features/programacion/programacion.routes';
import { vuelosRouter } from './features/vuelos/vuelos.routes';

const app = express();
const port = Number(process.env.PORT ?? 3000);

// Orden importa: cors y json antes de las rutas, así cada request llega preparado
app.use(cors());
app.use(express.json());

// Log de cada pedido: si la app no llega a la PC, esta línea nunca aparece
app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} desde ${req.ip}`);
  next();
});

// Prueba mínima: si responde, Express está vivo aunque la base falle
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(aeropuertosRouter);
app.use(libroRouter);
app.use(mapaRouter);
app.use(vuelosRouter);
app.use(programacionRouter);

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
