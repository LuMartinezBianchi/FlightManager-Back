// Exporta hojas del libro de vuelo a .xlsx usando la plantilla oficial (assets/libro_de_vuelo.xlsx).
// La plantilla tiene 14 filas de vuelos por pagina; si hay mas, se agrega una hoja por pagina.
import path from 'node:path';

import ExcelJS from 'exceljs';

import { prisma } from '../../db';

const PLANTILLA = path.join(__dirname, '../../../assets/libro_de_vuelo.xlsx');
const FILAS_POR_PAGINA = 14;
const PRIMERA_FILA = 5;

// Columnas de la plantilla de tiempos (en horas decimales en la base) y de cantidades
const COLUMNAS_TIEMPO = [
  ['L', 'sobreDiaPiloto'], ['M', 'sobreDiaCopiloto'], ['N', 'sobreNochePiloto'], ['O', 'sobreNocheCopiloto'],
  ['P', 'travesiaDiaPiloto'], ['Q', 'travesiaDiaCopiloto'], ['R', 'travesiaNochePiloto'], ['S', 'travesiaNocheCopiloto'],
  ['V', 'instruccion'], ['W', 'multimotor'], ['X', 'reactor'], ['Y', 'turbohelice'],
  ['Z', 'instrumentoRealPiloto'], ['AA', 'instrumentoRealCopiloto'], ['AB', 'instrumentoCapota'],
] as const;
const COLUMNA_FIRMA = 28; // AC (base 0)

type Hoja = Awaited<ReturnType<typeof prisma.planDeVuelo.findMany>>[number];

// Una hoja esta completa (verde) si tiene travesia o sobre aerodromo, aterrizajes, discriminacion y firma
export function hojaCompleta(h: Hoja) {
  const sobreOTravesia = COLUMNAS_TIEMPO.slice(0, 8).some(([, campo]) => h[campo] !== null);
  const discriminacion = h.instrumentoRealPiloto !== null || h.instrumentoRealCopiloto !== null || h.instrumentoCapota !== null;
  return sobreOTravesia && h.aterrizajes !== null && discriminacion && !!h.firma;
}

// "07:15" -> fraccion de dia, que es como Excel guarda una hora
const horaAExcel = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return (h * 60 + m) / 1440;
};

export type ResultadoExportacion = { ok: true; archivo: Buffer } | { ok: false; error: string };

export async function exportarLibro(vuelos: { number: string; date: string }[]): Promise<ResultadoExportacion> {
  const hojas = await prisma.planDeVuelo.findMany({
    where: { OR: vuelos.map((v) => ({ number: v.number, fecha: new Date(`${v.date}T00:00:00Z`) })) },
    orderBy: [{ fecha: 'asc' }, { horaSalida: 'asc' }],
  });

  if (hojas.length !== vuelos.length) return { ok: false, error: 'Hay vuelos sin hoja en el libro' };
  const incompletas = hojas.filter((h) => !hojaCompleta(h));
  if (incompletas.length > 0) {
    return { ok: false, error: `Solo se pueden exportar hojas completas: ${incompletas.map((h) => h.number).join(', ')}` };
  }

  return { ok: true, archivo: await construirLibro(hojas) };
}

// Arma el .xlsx a partir de la plantilla con las hojas ya validadas
export async function construirLibro(hojas: Hoja[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(PLANTILLA);
  const plantilla = libro.worksheets[0];

  const paginas: Hoja[][] = [];
  for (let i = 0; i < hojas.length; i += FILAS_POR_PAGINA) paginas.push(hojas.slice(i, i + FILAS_POR_PAGINA));

  // Una copia de la plantilla vacia por cada pagina extra
  const modeloVacio = JSON.parse(JSON.stringify(plantilla.model));
  const hojasExcel = [plantilla];
  for (let i = 1; i < paginas.length; i++) {
    const copia = libro.addWorksheet(`Página ${i + 1}`);
    copia.model = { ...JSON.parse(JSON.stringify(modeloVacio)), mergeCells: modeloVacio.merges, name: `Página ${i + 1}`, id: copia.id };
    hojasExcel.push(copia);
  }
  plantilla.name = 'Página 1';

  paginas.forEach((pagina, indice) => {
    const ws = hojasExcel[indice];
    ws.getCell('A1').value = `AÑO ${pagina[0].fecha.getUTCFullYear()}`;

    pagina.forEach((hoja, i) => {
      const fila = PRIMERA_FILA + i;
      const celda = (col: string) => ws.getCell(`${col}${fila}`);

      celda('A').value = hoja.fecha.getUTCDate();
      celda('B').value = hoja.fecha.getUTCMonth() + 1;
      celda('C').value = horaAExcel(hoja.horaSalida);
      celda('D').value = hoja.desde;
      celda('E').value = hoja.hasta;
      celda('F').value = horaAExcel(hoja.horaLlegada);
      celda('G').value = hoja.finalidadVuelo;
      celda('H').value = hoja.marca;
      celda('I').value = hoja.matricula;
      celda('J').value = hoja.potencia;
      celda('K').value = hoja.clase;

      for (const [col, campo] of COLUMNAS_TIEMPO) {
        const valor = hoja[campo];
        if (valor !== null) celda(col).value = valor / 24;
      }
      if (hoja.navegadorMecanico !== null) celda('T').value = hoja.navegadorMecanico;
      if (hoja.aterrizajes !== null) celda('U').value = hoja.aterrizajes;

      // Firma: PNG en base64 (data URL) dentro de la celda
      if (hoja.firma) {
        const imagen = libro.addImage({ base64: hoja.firma, extension: 'png' });
        ws.addImage(imagen, {
          tl: { col: COLUMNA_FIRMA + 0.05, row: fila - 1 + 0.05 },
          ext: { width: 220, height: 36 },
          editAs: 'oneCell',
        });
      }
    });
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
