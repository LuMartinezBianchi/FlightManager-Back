// Meteorologia de aeropuertos. Consulta los METAR del Aviation Weather Center de NOAA (gratis, sin clave).
// No conoce HTTP de la app ni la base: recibe codigos OACI y devuelve el reporte mas reciente de cada uno.

const URL_METAR = 'https://aviationweather.gov/api/data/metar';
const TIMEOUT_MS = 8000;
// El METAR se emite cada 30 o 60 minutos: no hace falta pedirlo mas seguido
const VIGENCIA_MS = 5 * 60 * 1000;

export type Meteo = {
  icao: string;
  // Celsius
  temp: number | null;
  // Grados, o "VRB" si el viento es variable
  windDir: number | 'VRB' | null;
  // Nudos
  windSpeed: number | null;
  // Millas terrestres tal como las informa el METAR (puede ser "6+")
  visibility: string | null;
  // hPa
  pressure: number | null;
  // Mayor cobertura de nubes: CLR, FEW, SCT, BKN, OVC...
  cloudCover: string | null;
  // VFR, MVFR, IFR o LIFR
  flightCategory: string | null;
  // Hora de la observacion (ISO)
  observedAt: string;
  raw: string;
};

type MetarNoaa = {
  icaoId: string;
  obsTime: number;
  temp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  visib?: string | number | null;
  altim?: number | null;
  cover?: string | null;
  fltCat?: string | null;
  rawOb: string;
};

const cache = new Map<string, { guardado: number; datos: Meteo }>();

function convertir(m: MetarNoaa): Meteo {
  return {
    icao: m.icaoId,
    temp: m.temp ?? null,
    windDir: m.wdir === 'VRB' ? 'VRB' : typeof m.wdir === 'number' ? m.wdir : null,
    windSpeed: m.wspd ?? null,
    visibility: m.visib === undefined || m.visib === null ? null : String(m.visib),
    pressure: m.altim ?? null,
    cloudCover: m.cover ?? null,
    flightCategory: m.fltCat ?? null,
    observedAt: new Date(m.obsTime * 1000).toISOString(),
    raw: m.rawOb,
  };
}

// Devuelve el reporte de cada aeropuerto que tenga uno; los que no informan METAR simplemente no aparecen
export async function getMeteo(icaos: string[]): Promise<Meteo[]> {
  const ahora = Date.now();
  const resultado: Meteo[] = [];
  const faltantes: string[] = [];

  for (const icao of icaos) {
    const guardado = cache.get(icao);
    if (guardado && ahora - guardado.guardado < VIGENCIA_MS) resultado.push(guardado.datos);
    else faltantes.push(icao);
  }

  if (faltantes.length > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${URL_METAR}?ids=${faltantes.join(',')}&format=json`, { signal: controller.signal });
      if (!response.ok) throw new Error(`NOAA respondio ${response.status}`);
      // Sin reportes, NOAA responde 204 sin cuerpo
      const reportes = response.status === 204 ? [] : ((await response.json()) as MetarNoaa[]);
      for (const reporte of reportes) {
        const datos = convertir(reporte);
        cache.set(datos.icao, { guardado: ahora, datos });
        resultado.push(datos);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return resultado;
}
