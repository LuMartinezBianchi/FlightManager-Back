// =============================================================================
// FlightManager - API REST (Express + Prisma + SQLite)
//
// INDICE DE ENDPOINTS (en este orden estan abajo):
//   GET    /api/health                       chequeo de que Express vive
//   GET    /api/aeropuertos                  catalogo de aeropuertos
//   GET    /api/vuelos                       lista de vuelos
//   POST   /api/vuelos                       guarda una lista de vuelos
//   PUT    /api/vuelos/:number/:fecha        reemplaza un vuelo
//   DELETE /api/vuelos/:number/:fecha        borra un vuelo
//   GET    /api/vuelos/:number/mapa          origen y destino con coordenadas
//   GET    /api/programacion                 tipo de actividad de cada dia
//   POST   /api/programacion                 guarda el tipo de cada dia
//   GET    /api/libro                        hojas del libro de vuelo
//   PUT    /api/libro/:number/:fecha         crea o reemplaza una hoja
//   POST   /api/libro/exportar               devuelve el libro en .xlsx
//   GET    /api/meteo?icao=SAEZ,SACO         METAR de cada aeropuerto (NOAA)
//
// Archivos de apoyo (todos en src/):
//   db.ts            el PrismaClient compartido
//   validaciones.ts  valida el body de POST/PUT antes de tocar la base
//   exportar.ts      arma el .xlsx del libro
//   meteo.ts         consulta los METAR a NOAA
//
// Fechas: viajan como AAAA-MM-DD y se guardan a medianoche UTC.
// Un vuelo se identifica por numero + fecha (el mismo numero vuelve otro dia).
// =============================================================================

// dotenv carga las variables definidas en .env (DATABASE_URL, PORT).
import "dotenv/config";

import cors from "cors";
import express from "express";

import { prisma } from "./db";
import { exportarLibro } from "./exportar";
import { getMeteo } from "./meteo";
import {
  aFecha,
  CAMPOS_TIEMPO,
  decimalATiempo,
  deFecha,
  esFechaReal,
  validarDias,
  validarHoja,
  validarVuelos,
  yaAterrizo,
  type NuevoVuelo,
} from "./validaciones";

// -----------------------------------------------------------------------------
// 1. Configuracion inicial
// -----------------------------------------------------------------------------

const app = express();
const port = Number(process.env.PORT ?? 3000);

// CORS permite que la app movil (otra IP) llame a la API.
// express.json() convierte el body JSON en req.body.
app.use(cors());
app.use(express.json());

// Log de cada pedido: si la app no llega a la PC, esta linea nunca aparece.
app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} desde ${req.ip}`);
  next();
});

// Convierte un NuevoVuelo (ya validado) en los datos que guarda Prisma.
// Lo usan POST y PUT de /api/vuelos. idPorIata: codigo IATA -> id del aeropuerto.
function datosDeVuelo(vuelo: NuevoVuelo, idPorIata: Map<string, number>) {
  return {
    number: vuelo.number,
    date: aFecha(vuelo.date),
    originId: idPorIata.get(vuelo.from)!,
    destinationId: idPorIata.get(vuelo.to)!,
    dep: vuelo.dep,
    arr: vuelo.arr,
    duration: vuelo.duration,
    aircraft: vuelo.aircraft ?? null,
    crew: vuelo.crew ?? null,
  };
}

// Busca los aeropuertos por IATA y devuelve un mapa IATA -> id.
async function idsPorIata(codigos: string[]) {
  const aeropuertos = await prisma.aeropuerto.findMany({ where: { iata: { in: codigos } } });
  return new Map(aeropuertos.map((a) => [a.iata, a.id]));
}

// -----------------------------------------------------------------------------
// 2. Health
// -----------------------------------------------------------------------------

// GET /api/health
// Prueba minima: si responde, Express esta vivo aunque la base falle.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// 3. Aeropuertos  (tabla: aeropuertos, solo lectura)
// -----------------------------------------------------------------------------

// GET /api/aeropuertos
// Catalogo (IATA, OACI, nombre). La app lo usa para validar la carga manual.
app.get("/api/aeropuertos", async (_req, res) => {
  const aeropuertos = await prisma.aeropuerto.findMany({
    select: { iata: true, icao: true, name: true },
    orderBy: { iata: "asc" },
  });

  res.json(aeropuertos);
});

// -----------------------------------------------------------------------------
// 4. Vuelos  (tabla: vuelos + aeropuertos)
// -----------------------------------------------------------------------------

// GET /api/vuelos
// Lista los vuelos con origen y destino en codigo IATA.
app.get("/api/vuelos", async (_req, res) => {
  const vuelos = await prisma.vuelo.findMany({
    include: { origin: true, destination: true },
    orderBy: [{ date: "asc" }, { dep: "asc" }],
  });

  res.json(
    vuelos.map((v) => ({
      number: v.number,
      date: deFecha(v.date),
      from: v.origin.iata,
      to: v.destination.iata,
      dep: v.dep,
      arr: v.arr,
      duration: v.duration,
      aircraft: v.aircraft,
      crew: v.crew,
    })),
  );
});

// POST /api/vuelos
// Body: lista de { number, date, from, to, dep, arr, ... }.
// Guarda TODOS o NINGUNO. 201 ok | 400 fila invalida | 409 algun vuelo ya existe.
app.post("/api/vuelos", async (req, res) => {
  const validacion = await validarVuelos(req.body);
  if (!validacion.ok) {
    return res.status(400).json({ error: "Hay filas con datos inválidos", errores: validacion.errores });
  }
  const vuelos = validacion.vuelos;

  // Duplicados: los que ya estan en la base + los repetidos dentro del mismo envio.
  const etiqueta = (numero: string, fecha: string) => `${numero} ${fecha}`;
  const yaGuardados = await prisma.vuelo.findMany({
    where: { OR: vuelos.map((v) => ({ number: v.number, date: aFecha(v.date) })) },
    select: { number: true, date: true },
  });
  const enEnvio = vuelos.map((v) => etiqueta(v.number, v.date));
  const repetidos = enEnvio.filter((e, i) => enEnvio.indexOf(e) !== i);
  const duplicados = [
    ...new Set([...yaGuardados.map((v) => etiqueta(v.number, deFecha(v.date))), ...repetidos]),
  ];
  if (duplicados.length > 0) {
    return res.status(409).json({ error: "Ya existen vuelos con esos números", duplicados });
  }

  // $transaction: si falla uno, no se guarda ninguno.
  const ids = await idsPorIata(vuelos.flatMap((v) => [v.from, v.to]));
  await prisma.$transaction(vuelos.map((v) => prisma.vuelo.create({ data: datosDeVuelo(v, ids) })));

  res.status(201).json({ insertados: vuelos.length });
});

// PUT /api/vuelos/:number/:fecha
// Reemplaza el vuelo identificado por numero + fecha con el body (un solo vuelo).
// 200 ok | 400 datos invalidos | 404 no existe | 409 el nuevo numero+fecha ya existe.
app.put("/api/vuelos/:number/:fecha", async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!esFechaReal(fecha)) return res.status(400).json({ error: "La fecha tiene que ser AAAA-MM-DD" });

  const validacion = await validarVuelos([req.body]);
  if (!validacion.ok) {
    return res.status(400).json({ error: "Hay datos inválidos", errores: validacion.errores });
  }
  const vuelo = validacion.vuelos[0];

  const actual = await prisma.vuelo.findFirst({
    where: { number: numero, date: aFecha(fecha) },
    select: { id: true },
  });
  if (!actual) return res.status(404).json({ error: "No existe el vuelo" });

  try {
    const ids = await idsPorIata([vuelo.from, vuelo.to]);
    await prisma.vuelo.update({ where: { id: actual.id }, data: datosDeVuelo(vuelo, ids) });
    res.json({ ok: true });
  } catch (e) {
    // P2002: choca con la clave unica numero + fecha de otro vuelo.
    if ((e as { code?: string }).code === "P2002") {
      return res.status(409).json({ error: "Ya existe un vuelo con ese número y fecha" });
    }
    throw e;
  }
});

// DELETE /api/vuelos/:number/:fecha
// Borra el vuelo. 204 ok (sin body) | 400 fecha invalida | 404 no existe.
app.delete("/api/vuelos/:number/:fecha", async (req, res) => {
  const numero = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!esFechaReal(fecha)) return res.status(400).json({ error: "La fecha tiene que ser AAAA-MM-DD" });

  const borrados = await prisma.vuelo.deleteMany({ where: { number: numero, date: aFecha(fecha) } });
  if (borrados.count === 0) return res.status(404).json({ error: "No existe el vuelo" });

  res.status(204).end();
});

// GET /api/vuelos/:number/mapa?fecha=AAAA-MM-DD
// Coordenadas de origen y destino para dibujar el mapa. Sin ?fecha= toma el vuelo mas cercano.
// 200 ok | 400 datos invalidos | 404 no existe.
app.get("/api/vuelos/:number/mapa", async (req, res) => {
  const number = req.params.number.trim().toUpperCase();
  if (!number) return res.status(400).json({ error: "El número de vuelo no es válido" });

  const fecha = typeof req.query.fecha === "string" ? req.query.fecha : undefined;
  if (fecha !== undefined && !esFechaReal(fecha)) {
    return res.status(400).json({ error: "La fecha tiene que ser AAAA-MM-DD" });
  }

  const vuelo = await prisma.vuelo.findFirst({
    where: fecha ? { number, date: aFecha(fecha) } : { number },
    orderBy: { date: "asc" },
    include: { origin: true, destination: true },
  });
  if (!vuelo) return res.status(404).json({ error: "No existe el vuelo" });

  const punto = (a: typeof vuelo.origin) => ({ iata: a.iata, name: a.name, latitude: a.latitude, longitude: a.longitude });
  res.json({ number: vuelo.number, origin: punto(vuelo.origin), destination: punto(vuelo.destination) });
});

// -----------------------------------------------------------------------------
// 5. Programacion  (tabla: programacion)
//    Tipo de actividad de cada dia: vuelo | deadhead | reserva | franco | sin_asignar
// -----------------------------------------------------------------------------

// GET /api/programacion
// Lista los dias con su tipo.
app.get("/api/programacion", async (_req, res) => {
  const dias = await prisma.programacion.findMany({ orderBy: { date: "asc" } });

  res.json(dias.map((d) => ({ date: deFecha(d.date), type: d.type })));
});

// POST /api/programacion
// Body: lista de { date, type }. Si el dia ya existe le cambia el tipo (upsert).
// 201 ok | 400 fila invalida.
app.post("/api/programacion", async (req, res) => {
  const validacion = validarDias(req.body);
  if (!validacion.ok) {
    return res.status(400).json({ error: "Hay filas con datos inválidos", errores: validacion.errores });
  }

  await prisma.$transaction(
    validacion.dias.map((d) =>
      prisma.programacion.upsert({
        where: { date: aFecha(d.date) },
        update: { type: d.type },
        create: { date: aFecha(d.date), type: d.type },
      }),
    ),
  );

  res.status(201).json({ guardados: validacion.dias.length });
});

// -----------------------------------------------------------------------------
// 6. Libro de vuelo  (tabla: plan_de_vuelo, ligada a vuelos por numero + fecha)
// -----------------------------------------------------------------------------

// GET /api/libro
// Devuelve cada hoja con los mismos keys del formulario de la app (todo como texto).
app.get("/api/libro", async (_req, res) => {
  const hojas = await prisma.planDeVuelo.findMany({ orderBy: { fecha: "asc" } });

  res.json(
    hojas.map((h) => {
      const fecha = deFecha(h.fecha);
      const [anio, mes, dia] = fecha.split("-");
      const salida: Record<string, string> = {
        number: h.number,
        date: fecha,
        anio,
        mes: String(Number(mes)),
        dia: String(Number(dia)),
        horaSalida: h.horaSalida,
        desde: h.desde,
        hasta: h.hasta,
        horaLlegada: h.horaLlegada,
        finalidadVuelo: h.finalidadVuelo,
        marca: h.marca,
        matricula: h.matricula,
        potencia: String(h.potencia),
        clase: h.clase,
        navegadorMecanico: h.navegadorMecanico === null ? "" : String(h.navegadorMecanico),
        aterrizajes: h.aterrizajes === null ? "" : String(h.aterrizajes),
        firma: h.firma ?? "",
      };
      // Tiempos: horas decimales en la base (1.5) -> "1:30" para el formulario.
      for (const campo of CAMPOS_TIEMPO) {
        salida[campo] = h[campo] === null ? "" : decimalATiempo(h[campo]);
      }
      return salida;
    }),
  );
});

// PUT /api/libro/:number/:fecha
// Crea la hoja del vuelo o la reemplaza si ya existia (upsert).
// 200 ok | 400 datos invalidos o vuelo que todavia no aterrizo | 404 el vuelo no existe.
app.put("/api/libro/:number/:fecha", async (req, res) => {
  const number = req.params.number.toUpperCase();
  const { fecha } = req.params;
  if (!esFechaReal(fecha)) return res.status(400).json({ error: "La fecha tiene que ser AAAA-MM-DD" });

  const validacion = await validarHoja(req.body);
  if (!validacion.ok) return res.status(400).json({ error: "Hay datos inválidos", errores: validacion.errores });
  const hoja = validacion.hoja;

  // El vuelo tiene que existir y haber aterrizado.
  const vuelo = await prisma.vuelo.findUnique({
    where: { number_date: { number, date: aFecha(fecha) } },
    select: { dep: true, arr: true },
  });
  if (!vuelo) return res.status(404).json({ error: "No existe el vuelo" });
  if (!yaAterrizo(fecha, vuelo.dep, vuelo.arr)) {
    return res.status(400).json({ error: "El vuelo todavía no se realizó" });
  }

  const datos = {
    // La clave es la fecha del vuelo (de la URL), no la que se tipee en el formulario.
    fecha: aFecha(fecha),
    horaSalida: hoja.horaSalida,
    desde: hoja.desde,
    hasta: hoja.hasta,
    horaLlegada: hoja.horaLlegada,
    finalidadVuelo: hoja.finalidadVuelo,
    marca: hoja.marca,
    matricula: hoja.matricula,
    potencia: hoja.potencia,
    clase: hoja.clase,
    navegadorMecanico: hoja.navegadorMecanico,
    aterrizajes: hoja.aterrizajes,
    firma: hoja.firma,
    // Los tiempos que no vienen se limpian: lo borrado en el formulario se borra de la base.
    ...Object.fromEntries(CAMPOS_TIEMPO.map((campo) => [campo, hoja.tiempos[campo] ?? null])),
  };

  await prisma.planDeVuelo.upsert({
    where: { number_fecha: { number, fecha: datos.fecha } },
    create: { number, ...datos },
    update: datos,
  });

  res.json({ ok: true });
});

// POST /api/libro/exportar
// Body: [{ number, date }, ...] (los vuelos elegidos). Responde el archivo .xlsx.
// 200 archivo | 400 pedido invalido, falta alguna hoja o alguna esta incompleta.
app.post("/api/libro/exportar", async (req, res) => {
  const pedidos = req.body;
  const valido =
    Array.isArray(pedidos) &&
    pedidos.length > 0 &&
    pedidos.every((p) => typeof p?.number === "string" && esFechaReal(p?.date ?? ""));
  if (!valido) return res.status(400).json({ error: "Se espera una lista de vuelos (number y date)" });

  const vuelos = (pedidos as { number: string; date: string }[]).map((p) => ({
    number: p.number.toUpperCase(),
    date: p.date,
  }));
  const resultado = await exportarLibro(vuelos);
  if (!resultado.ok) return res.status(400).json({ error: resultado.error });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="libro_de_vuelo.xlsx"');
  res.send(resultado.archivo);
});

// -----------------------------------------------------------------------------
// 7. Meteorologia  (no usa la base: consulta a NOAA)
// -----------------------------------------------------------------------------

// GET /api/meteo?icao=SAEZ,SACO
// Ultimo METAR de hasta 10 aeropuertos. 200 ok | 400 codigos invalidos | 502 falla NOAA.
app.get("/api/meteo", async (req, res) => {
  const icaos = String(req.query.icao ?? "")
    .split(",")
    .map((codigo) => codigo.trim().toUpperCase())
    .filter(Boolean);

  if (icaos.length === 0 || icaos.length > 10 || !icaos.every((c) => /^[A-Z]{4}$/.test(c))) {
    return res.status(400).json({ error: "Pasá hasta 10 códigos OACI de 4 letras separados por coma (icao=SAEZ,SACO)" });
  }

  try {
    res.json(await getMeteo([...new Set(icaos)]));
  } catch {
    res.status(502).json({ error: "No se pudo consultar la meteorología" });
  }
});

// -----------------------------------------------------------------------------
// 8. Errores inesperados y arranque
// -----------------------------------------------------------------------------

// Si una ruta falla sin controlar el error (ej. se cayo la base), responde 500 en JSON.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Error inesperado en el servidor" });
});

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
