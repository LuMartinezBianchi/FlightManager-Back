// =============================================================================
// FlightManager - API REST (Express + Prisma + SQLite)
//
// INDICE DE ENDPOINTS (en este orden estan abajo):
//   GET    /api/health                       chequeo de que Express vive
//   POST   /api/registro                     crea una cuenta y abre sesion
//   POST   /api/login                        abre sesion
//   POST   /api/logout                  (S)  cierra sesion
//   GET    /api/aeropuertos                  catalogo de aeropuertos
//   GET    /api/vuelos                  (S)  lista de vuelos
//   POST   /api/vuelos                  (S)  guarda una lista de vuelos
//   PUT    /api/vuelos/:number/:fecha   (S)  reemplaza un vuelo
//   DELETE /api/vuelos/:number/:fecha   (S)  borra un vuelo
//   GET    /api/vuelos/:number/mapa     (S)  origen y destino con coordenadas
//   GET    /api/programacion            (S)  tipo de actividad de cada dia
//   POST   /api/programacion            (S)  guarda el tipo de cada dia
//   GET    /api/libro                   (S)  hojas del libro de vuelo
//   PUT    /api/libro/:number/:fecha    (S)  crea o reemplaza una hoja
//   POST   /api/libro/exportar          (S)  devuelve el libro en .xlsx
//   GET    /api/meteo?icao=SAEZ,SACO         METAR de cada aeropuerto (NOAA)
//
// (S) = requiere sesion: el celular manda "Authorization: Bearer <token>" y el back
// solo devuelve o toca datos de ESE piloto. Sin token valido responde 401.
//
// Archivos de apoyo (todos en src/):
//   auth.ts          hash de contraseñas, tokens y el chequeo de sesion
//   db.ts            el PrismaClient compartido
//   validaciones.ts  valida el body de POST/PUT antes de tocar la base
//   exportar.ts      arma el .xlsx del libro
//   meteo.ts         consulta los METAR a NOAA
//
// Fechas: viajan como AAAA-MM-DD y se guardan a medianoche UTC.
// Un vuelo se identifica por piloto + numero + fecha (el mismo numero vuelve otro dia).
// =============================================================================

// dotenv carga las variables definidas en .env (DATABASE_URL, PORT).
import "dotenv/config";

import cors from "cors";
import express from "express";

import { hashear, nuevoSalt, nuevoToken, pilotoDe, requerirSesion } from "./auth";
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

// Rutas con sesion: sin token valido responden 401 y su codigo ni se ejecuta.
// (health, registro, login, aeropuertos y meteo quedan abiertos.)
app.use("/api/vuelos", requerirSesion); // incluye /api/vuelos/:number/mapa
app.use("/api/programacion", requerirSesion);
app.use("/api/libro", requerirSesion); // incluye /api/libro/exportar

// Convierte un NuevoVuelo (ya validado) en los datos que guarda Prisma.
// Lo usan POST y PUT de /api/vuelos. idPorIata: codigo IATA -> id del aeropuerto.
function datosDeVuelo(vuelo: NuevoVuelo, idPorIata: Map<string, number>, pilotoId: number) {
  return {
    pilotoId,
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
// 2. Health y cuentas (registro, login, logout)
// -----------------------------------------------------------------------------

// GET /api/health
// Prueba minima: si responde, Express esta vivo aunque la base falle.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Lee email y contraseña del body (email en minuscula y sin espacios).
function leerCuenta(body: unknown) {
  const d = (body ?? {}) as Record<string, unknown>;
  return {
    email: typeof d.email === "string" ? d.email.trim().toLowerCase() : "",
    password: typeof d.password === "string" ? d.password : "",
  };
}

// POST /api/registro
// Body: { email, password }. Guarda el salt y el hash de (contraseña + salt), nunca la contraseña.
// 201 { token } (ya queda con sesion abierta) | 400 datos invalidos | 409 el email ya existe.
app.post("/api/registro", async (req, res) => {
  const { email, password } = leerCuenta(req.body);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Email inválido" });
  if (password.length < 8) return res.status(400).json({ error: "La contraseña tiene que tener al menos 8 caracteres" });

  if (await prisma.piloto.findUnique({ where: { email } })) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
  }

  const salt = nuevoSalt();
  const token = nuevoToken();
  await prisma.piloto.create({ data: { email, salt, passwordHash: await hashear(password, salt), token } });

  res.status(201).json({ token });
});

// POST /api/login
// Body: { email, password }. Vuelve a calcular hash(contraseña + salt guardado) y compara HASH contra HASH.
// 200 { token } | 401 email o contraseña incorrectos (mismo mensaje en los dos casos).
app.post("/api/login", async (req, res) => {
  const { email, password } = leerCuenta(req.body);

  const piloto = await prisma.piloto.findUnique({ where: { email } });
  if (!piloto || (await hashear(password, piloto.salt)) !== piloto.passwordHash) {
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
  }

  // Cada login crea un token nuevo (pisa el anterior).
  const token = nuevoToken();
  await prisma.piloto.update({ where: { id: piloto.id }, data: { token } });

  res.json({ token });
});

// POST /api/logout
// Borra el token del piloto: desde ese momento el token viejo da 401. 204 ok | 401 sin sesion.
app.post("/api/logout", requerirSesion, async (_req, res) => {
  await prisma.piloto.update({ where: { id: pilotoDe(res) }, data: { token: null } });

  res.status(204).end();
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
// Lista los vuelos DEL PILOTO con origen y destino en codigo IATA.
app.get("/api/vuelos", async (_req, res) => {
  const vuelos = await prisma.vuelo.findMany({
    where: { pilotoId: pilotoDe(res) },
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
  const pilotoId = pilotoDe(res);

  // Duplicados: los que ya estan en la base (de ESTE piloto) + los repetidos dentro del mismo envio.
  const etiqueta = (numero: string, fecha: string) => `${numero} ${fecha}`;
  const yaGuardados = await prisma.vuelo.findMany({
    where: { pilotoId, OR: vuelos.map((v) => ({ number: v.number, date: aFecha(v.date) })) },
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
  await prisma.$transaction(vuelos.map((v) => prisma.vuelo.create({ data: datosDeVuelo(v, ids, pilotoId) })));

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
  const pilotoId = pilotoDe(res);

  // Solo busca entre los vuelos de este piloto: uno ajeno responde 404, como si no existiera.
  const actual = await prisma.vuelo.findFirst({
    where: { pilotoId, number: numero, date: aFecha(fecha) },
    select: { id: true },
  });
  if (!actual) return res.status(404).json({ error: "No existe el vuelo" });

  try {
    const ids = await idsPorIata([vuelo.from, vuelo.to]);
    await prisma.vuelo.update({ where: { id: actual.id }, data: datosDeVuelo(vuelo, ids, pilotoId) });
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

  const borrados = await prisma.vuelo.deleteMany({
    where: { pilotoId: pilotoDe(res), number: numero, date: aFecha(fecha) },
  });
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
    where: fecha ? { pilotoId: pilotoDe(res), number, date: aFecha(fecha) } : { pilotoId: pilotoDe(res), number },
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
  const dias = await prisma.programacion.findMany({ where: { pilotoId: pilotoDe(res) }, orderBy: { date: "asc" } });

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

  const pilotoId = pilotoDe(res);

  await prisma.$transaction(
    validacion.dias.map((d) =>
      prisma.programacion.upsert({
        where: { pilotoId_date: { pilotoId, date: aFecha(d.date) } },
        update: { type: d.type },
        create: { pilotoId, date: aFecha(d.date), type: d.type },
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
  const hojas = await prisma.planDeVuelo.findMany({ where: { pilotoId: pilotoDe(res) }, orderBy: { fecha: "asc" } });

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

  // El vuelo tiene que ser de este piloto, existir y haber aterrizado.
  const pilotoId = pilotoDe(res);
  const vuelo = await prisma.vuelo.findUnique({
    where: { pilotoId_number_date: { pilotoId, number, date: aFecha(fecha) } },
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
    where: { pilotoId_number_fecha: { pilotoId, number, fecha: datos.fecha } },
    create: { pilotoId, number, ...datos },
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
  const resultado = await exportarLibro(vuelos, pilotoDe(res));
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
