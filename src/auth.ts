// Contraseñas y sesion. Las rutas /api/registro, /api/login y /api/logout estan en index.ts;
// aca estan las piezas que usan:
//   hashear      -> hash(contraseña + salt), lo que se guarda en vez de la contraseña
//   nuevoToken   -> la "llave" de la sesion que recibe el celular
//   requerirSesion -> middleware que deja pasar solo a quien manda un token valido
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

import type { NextFunction, Request, Response } from "express";

import { prisma } from "./db";

const scryptAsync = promisify(scrypt);

// Texto aleatorio unico para cada usuario. Se guarda junto al hash (no es secreto).
// Sirve para que dos usuarios con la misma contraseña tengan hashes distintos.
export function nuevoSalt(): string {
  return randomBytes(16).toString("hex");
}

// hash(contraseña + salt). scrypt es un hash lento a proposito: si alguien roba la base,
// probar millones de contraseñas le lleva muchisimo mas que con un SHA-256 comun.
export async function hashear(password: string, salt: string): Promise<string> {
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return hash.toString("hex");
}

// Token de sesion: 32 bytes aleatorios, imposible de adivinar.
export function nuevoToken(): string {
  return randomBytes(32).toString("hex");
}

// Middleware: el celular manda "Authorization: Bearer <token>" en cada pedido.
// Si el token es de un piloto, deja su id en res.locals; si no, responde 401 y la ruta no se ejecuta.
export async function requerirSesion(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  const piloto = token ? await prisma.piloto.findUnique({ where: { token } }) : null;

  if (!piloto) return res.status(401).json({ error: "Sesión inválida o vencida" });

  res.locals.pilotoId = piloto.id;
  next();
}

// Id del piloto que hizo el pedido. Solo se usa en rutas que pasan por requerirSesion.
// IMPORTANTE: el id sale SIEMPRE de la sesion, nunca del body que manda el celular.
export function pilotoDe(res: Response): number {
  return res.locals.pilotoId as number;
}
