import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

import type { NextFunction, Request, Response } from "express";

import { prisma } from "./db";

const scryptAsync = promisify(scrypt);

export function nuevoSalt(): string {
  return randomBytes(16).toString("hex");
}

// hash(contraseña + salt). scrypt es un hash lento a proposito: si alguien roba la base
export async function hashear(password: string, salt: string): Promise<string> {
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return hash.toString("hex");
}

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
export function pilotoDe(res: Response): number {
  return res.locals.pilotoId as number;
}
