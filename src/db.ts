import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client.ts";

const dbPath = path.resolve(import.meta.dir, "..", "dev.db");
const adapter = new PrismaLibSql({ url: `file:${dbPath}` });

export const prisma = new PrismaClient({ adapter });
