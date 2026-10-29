// Hojas del libro de vuelo. Solo consulta Prisma; no conoce HTTP.
import { prisma } from '../../db';
import { CAMPOS_TIEMPO, decimalATiempo, type HojaValida } from './libro.validation';

// Devuelve cada hoja con los mismos keys del formulario de la app (todo texto).
// number + date identifican el vuelo de la programacion al que pertenece.
export async function listHojas() {
  const hojas = await prisma.planDeVuelo.findMany({ orderBy: { fecha: 'asc' } });

  return hojas.map((hoja) => {
    const fecha = hoja.fecha.toISOString().slice(0, 10);
    const [anio, mes, dia] = fecha.split('-');
    const salida: Record<string, string> = {
      number: hoja.number,
      date: fecha,
      anio,
      mes: String(Number(mes)),
      dia: String(Number(dia)),
      horaSalida: hoja.horaSalida,
      desde: hoja.desde,
      hasta: hoja.hasta,
      horaLlegada: hoja.horaLlegada,
      finalidadVuelo: hoja.finalidadVuelo,
      marca: hoja.marca,
      matricula: hoja.matricula,
      potencia: String(hoja.potencia),
      clase: hoja.clase,
      navegadorMecanico: hoja.navegadorMecanico === null ? '' : String(hoja.navegadorMecanico),
      aterrizajes: hoja.aterrizajes === null ? '' : String(hoja.aterrizajes),
      firma: hoja.firma ?? '',
    };
    for (const campo of CAMPOS_TIEMPO) {
      const valor = hoja[campo];
      salida[campo] = valor === null ? '' : decimalATiempo(valor);
    }
    return salida;
  });
}

// Crea la hoja del vuelo o, si ya existia, la reemplaza
export async function guardarHoja(number: string, date: string, hoja: HojaValida) {
  const datos = {
    fecha: new Date(`${hoja.fecha}T00:00:00Z`),
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
    // Los tiempos que no vienen se limpian: al reemplazar, lo borrado en el formulario se borra
    ...Object.fromEntries(CAMPOS_TIEMPO.map((campo) => [campo, hoja.tiempos[campo] ?? null])),
  };

  // La clave es la fecha del vuelo, no la que se tipee en el formulario
  const fecha = new Date(`${date}T00:00:00Z`);
  await prisma.planDeVuelo.upsert({
    where: { number_fecha: { number, fecha } },
    create: { number, ...datos, fecha },
    update: { ...datos, fecha },
  });
}
