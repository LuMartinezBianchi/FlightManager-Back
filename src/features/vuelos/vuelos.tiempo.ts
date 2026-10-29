// Calculos de tiempo de un vuelo, usados por el libro.

// Minutos desde la medianoche de "HH:mm"
function minutosDelDia(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// Fecha y hora de llegada. Si llega antes de salir, aterriza al dia siguiente
export function llegada(fecha: string, dep: string, arr: string) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const hora = arr || dep;
  const fin = new Date(anio, mes - 1, dia, Math.floor(minutosDelDia(hora) / 60), minutosDelDia(hora) % 60);
  if (minutosDelDia(hora) < minutosDelDia(dep)) fin.setDate(fin.getDate() + 1);
  return fin;
}

export function yaAterrizo(fecha: string, dep: string, arr: string, ahora = new Date()) {
  return llegada(fecha, dep, arr) <= ahora;
}

// Duracion en minutos. Usa el texto "1h 50m" y, si no se puede leer, la diferencia entre salida y llegada
export function duracionEnMinutos(duration: string, dep: string, arr: string) {
  const match = duration.match(/^(\d+)h\s*(\d+)m$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return (((minutosDelDia(arr || dep) - minutosDelDia(dep)) % 1440) + 1440) % 1440;
}
